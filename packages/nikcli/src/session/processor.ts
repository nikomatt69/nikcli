import { MessageV2 } from "./message-v2"
import { Log } from "@/util/log"
import { Identifier } from "@/id/id"
import { Session } from "."
import { Agent } from "@/agent/agent"
import { Snapshot } from "@/snapshot"
import { SessionSummary } from "./summary"
import { Bus } from "@/bus"
import { SessionRetry } from "./retry"
import { SessionStatus } from "./status"
import { Plugin } from "@/plugin"
import type { Provider } from "@/provider/provider"
import { LLM } from "./llm"
import { Config } from "@/config/config"
import { SessionCompaction } from "./compaction"
import { PermissionNext } from "@/permission/next"
import { Question } from "@/question"
import { DeltaCoalescer } from "./delta-coalescer"
import { Storage } from "@/storage/storage"

export namespace SessionProcessor {
  const DOOM_LOOP_THRESHOLD = 3
  const log = Log.create({ service: "session.processor" })

  export type Info = Awaited<ReturnType<typeof create>>
  export type Result = Awaited<ReturnType<Info["process"]>>

  // Doom-loop detection: returns PermissionNext.ask call if pattern detected
  function detectDoomLoop(
    buffer: Array<{ tool: string; input: unknown }>,
    toolName: string,
    toolInput: unknown,
    sessionID: string,
    agent: Agent.Info,
  ): Promise<void> | void {
    const entry = { tool: toolName, input: toolInput }
    buffer.push(entry)
    if (buffer.length > DOOM_LOOP_THRESHOLD) {
      buffer.shift()
    }

    if (buffer.length === DOOM_LOOP_THRESHOLD) {
      const lastThree = buffer.slice(-DOOM_LOOP_THRESHOLD)
      if (lastThree.every((p) => p.tool === toolName && Bun.deepEquals(p.input, toolInput))) {
        return PermissionNext.ask({
          permission: "doom_loop",
          patterns: [toolName],
          sessionID,
          metadata: {
            tool: toolName,
            input: toolInput,
          },
          always: [toolName],
          ruleset: agent.permission,
        })
      }
    }
  }

  export function create(input: {
    assistantMessage: MessageV2.Assistant
    sessionID: string
    model: Provider.Model
    abort: AbortSignal
  }) {
    const toolcalls: Record<string, MessageV2.ToolPart> = {}
    let snapshot: string | undefined
    let blocked = false
    let attempt = 0
    let needsCompaction = false
    // Ring buffer for doom-loop detection - avoids repeated storage I/O
    const doomLoopBuffer: Array<{ tool: string; input: unknown }> = []

    // Coalesce streaming delta writes to disk — publish Bus events immediately
    // for UI responsiveness, but batch disk writes to reduce ~500 writes/response
    // down to ~10-20 coalesced flushes.
    const coalescer = DeltaCoalescer

    // For streaming deltas: publish Bus event immediately but coalesce the disk write.
    // This avoids ~500 Storage.write calls per response while keeping the UI responsive.
    async function updatePartCoalesced(part: MessageV2.TextPart | MessageV2.ReasoningPart, delta: string) {
      Bus.publish(MessageV2.Event.PartUpdated, { part, delta })
      const key = ["part", part.messageID, part.id]
      coalescer.schedule(key, part, async (k, content) => {
        await Storage.write(k, content)
      })
    }

    // Hoisted: cleanup function used across retry iterations
    const cleanupRetryAttempt = async (attemptPartIDs: Set<string>) => {
      for (const partID of attemptPartIDs) {
        await Session.removePart({
          sessionID: input.sessionID,
          messageID: input.assistantMessage.id,
          partID,
        }).catch(() => {})
      }
      for (const key of Object.keys(toolcalls)) {
        delete toolcalls[key]
      }
      snapshot = undefined
    }

    const result = {
      get message() {
        return input.assistantMessage
      },
      partFromToolCall(toolCallID: string) {
        return toolcalls[toolCallID]
      },
      async process(streamInput: LLM.StreamInput) {
        log.info("process")
        needsCompaction = false
        const shouldBreak = (await Config.get()).experimental?.continue_loop_on_deny !== true
        while (true) {
          const attemptPartIDs = new Set<string>()
          const trackPart = <T extends { id: string }>(part: T) => {
            attemptPartIDs.add(part.id)
            return part
          }
          try {
            let currentText: MessageV2.TextPart | undefined
            let reasoningMap: Record<string, MessageV2.ReasoningPart> = {}
            const stream = await LLM.stream(streamInput)

            for await (const value of stream.fullStream) {
              input.abort.throwIfAborted()
              switch (value.type) {
                case "start":
                  SessionStatus.set(input.sessionID, { type: "busy" })
                  break

                case "reasoning-start":
                  if (value.id in reasoningMap) {
                    continue
                  }
                  reasoningMap[value.id] = trackPart({
                    id: Identifier.ascending("part"),
                    messageID: input.assistantMessage.id,
                    sessionID: input.assistantMessage.sessionID,
                    type: "reasoning",
                    text: "",
                    time: {
                      start: Date.now(),
                    },
                    metadata: value.providerMetadata,
                  })
                  break

                case "reasoning-delta":
                  if (value.id in reasoningMap) {
                    const part = reasoningMap[value.id]
                    part.text += value.text
                    if (value.providerMetadata) part.metadata = value.providerMetadata
                    if (part.text) await updatePartCoalesced(part, value.text)
                  }
                  break

                case "reasoning-end":
                  if (value.id in reasoningMap) {
                    const part = reasoningMap[value.id]
                    part.text = part.text.trimEnd()

                    part.time = {
                      ...part.time,
                      end: Date.now(),
                    }
                    if (value.providerMetadata) part.metadata = value.providerMetadata
                    // flushNow persists the part - no need for Session.updatePart (avoids double-write)
                    await coalescer.flushNow(["part", part.messageID, part.id]).catch(() => {})
                    delete reasoningMap[value.id]
                  }
                  break

                case "tool-input-start": {
                  const part = await Session.updatePart(
                    trackPart({
                      id: toolcalls[value.id]?.id ?? Identifier.ascending("part"),
                      messageID: input.assistantMessage.id,
                      sessionID: input.assistantMessage.sessionID,
                      type: "tool" as const,
                      tool: value.toolName,
                      callID: value.id,
                      state: {
                        status: "pending" as const,
                        input: {},
                        raw: "",
                      },
                    }),
                  )
                  toolcalls[value.id] = part as MessageV2.ToolPart
                  break
                }

                case "tool-input-delta":
                  break

                case "tool-input-end":
                  break

                case "tool-call": {
                  const match = toolcalls[value.toolCallId]
                  if (match) {
                    const part = await Session.updatePart({
                      ...match,
                      tool: value.toolName,
                      state: {
                        status: "running",
                        input: value.input,
                        time: {
                          start: Date.now(),
                        },
                      },
                      metadata: value.providerMetadata,
                    })
                    toolcalls[value.toolCallId] = part as MessageV2.ToolPart

                    // Use helper for doom-loop detection
                    const agent = await Agent.get(input.assistantMessage.agent)
                    await detectDoomLoop(
                      doomLoopBuffer,
                      value.toolName,
                      value.input,
                      input.assistantMessage.sessionID,
                      agent,
                    )
                  }
                  break
                }
                case "tool-result": {
                  const match = toolcalls[value.toolCallId]
                  if (match && match.state.status === "running") {
                    await Session.updatePart({
                      ...match,
                      state: {
                        status: "completed",
                        input: value.input ?? match.state.input,
                        output: value.output.output,
                        metadata: value.output.metadata,
                        title: value.output.title,
                        time: {
                          start: match.state.time.start,
                          end: Date.now(),
                        },
                        attachments: value.output.attachments,
                      },
                    })

                    delete toolcalls[value.toolCallId]
                  }
                  break
                }

                case "tool-error": {
                  const match = toolcalls[value.toolCallId]
                  if (match && match.state.status === "running") {
                    await Session.updatePart({
                      ...match,
                      state: {
                        status: "error",
                        input: value.input ?? match.state.input,
                        error: (value.error as any).toString(),
                        time: {
                          start: match.state.time.start,
                          end: Date.now(),
                        },
                      },
                    })

                    if (
                      value.error instanceof PermissionNext.RejectedError ||
                      value.error instanceof Question.RejectedError
                    ) {
                      blocked = shouldBreak
                    }
                    delete toolcalls[value.toolCallId]
                  }
                  break
                }
                case "error":
                  throw value.error

                case "start-step":
                  snapshot = await Snapshot.track()
                  await Session.updatePart(
                    trackPart({
                      id: Identifier.ascending("part"),
                      messageID: input.assistantMessage.id,
                      sessionID: input.sessionID,
                      snapshot,
                      type: "step-start" as const,
                    }),
                  )
                  break

                case "finish-step": {
                  const usage = Session.getUsage({
                    model: input.model,
                    usage: value.usage,
                    metadata: value.providerMetadata,
                  })
                  input.assistantMessage.finish = value.finishReason
                  input.assistantMessage.cost += usage.cost
                  input.assistantMessage.tokens = usage.tokens
                  await Session.updatePart(
                    trackPart({
                      id: Identifier.ascending("part"),
                      reason: value.finishReason,
                      snapshot: await Snapshot.track(),
                      messageID: input.assistantMessage.id,
                      sessionID: input.assistantMessage.sessionID,
                      type: "step-finish" as const,
                      tokens: usage.tokens,
                      cost: usage.cost,
                    }),
                  )
                  await Session.updateMessage(input.assistantMessage)
                  if (snapshot) {
                    const patch = await Snapshot.patch(snapshot)
                    if (patch.files.length) {
                      await Session.updatePart(
                        trackPart({
                          id: Identifier.ascending("part"),
                          messageID: input.assistantMessage.id,
                          sessionID: input.sessionID,
                          type: "patch" as const,
                          hash: patch.hash,
                          files: patch.files,
                        }),
                      )
                    }
                    snapshot = undefined
                  }
                  SessionSummary.summarize({
                    sessionID: input.sessionID,
                    messageID: input.assistantMessage.parentID,
                  })
                  if (await SessionCompaction.isOverflow({ tokens: usage.tokens, model: input.model })) {
                    needsCompaction = true
                  }
                  break
                }

                case "text-start":
                  currentText = trackPart({
                    id: Identifier.ascending("part"),
                    messageID: input.assistantMessage.id,
                    sessionID: input.assistantMessage.sessionID,
                    type: "text" as const,
                    text: "",
                    time: {
                      start: Date.now(),
                    },
                    metadata: value.providerMetadata,
                  })
                  break

                case "text-delta":
                  if (currentText) {
                    currentText.text += value.text
                    if (value.providerMetadata) currentText.metadata = value.providerMetadata
                    if (currentText.text) await updatePartCoalesced(currentText, value.text)
                  }
                  break

                case "text-end":
                  if (currentText) {
                    currentText.text = currentText.text.trimEnd()
                    const textOutput = await Plugin.trigger(
                      "experimental.text.complete",
                      {
                        sessionID: input.sessionID,
                        messageID: input.assistantMessage.id,
                        partID: currentText.id,
                      },
                      { text: currentText.text },
                    )
                    currentText.text = textOutput.text
                    currentText.time = {
                      start: currentText.time?.start ?? Date.now(),
                      end: Date.now(),
                    }
                    if (value.providerMetadata) currentText.metadata = value.providerMetadata
                    // flushNow persists the part - no need for Session.updatePart (avoids double-write)
                    await coalescer.flushNow(["part", currentText.messageID, currentText.id]).catch(() => {})
                  }
                  currentText = undefined
                  break

                case "finish":
                  break

                default:
                  log.info("unhandled", {
                    ...value,
                  })
                  continue
              }
              if (needsCompaction) break
            }
          } catch (e: any) {
            log.error("process", {
              error: e,
              stack: JSON.stringify(e.stack),
            })
            const error = MessageV2.fromError(e, { providerID: input.model.providerID })
            // TODO: Handle context overflow error
            const retry = SessionRetry.retryable(error)
            if (retry !== undefined) {
              const nextAttempt = attempt + 1
              if (nextAttempt <= SessionRetry.RETRY_MAX_ATTEMPTS) {
                attempt = nextAttempt
                const delay = SessionRetry.delay(attempt, error.name === "APIError" ? error : undefined)
                await cleanupRetryAttempt(attemptPartIDs)
                SessionStatus.set(input.sessionID, {
                  type: "retry",
                  attempt,
                  message: retry,
                  next: Date.now() + delay,
                })
                try {
                  await SessionRetry.sleep(delay, input.abort)
                } catch (sleepError) {
                  input.assistantMessage.error = MessageV2.fromError(sleepError, {
                    providerID: input.model.providerID,
                  })
                  break
                }
                input.abort.throwIfAborted()
                continue
              }
            }
            input.assistantMessage.error = error
            Bus.publish(Session.Event.Error, {
              sessionID: input.assistantMessage.sessionID,
              error: input.assistantMessage.error,
            })
          }
          if (snapshot) {
            const patch = await Snapshot.patch(snapshot)
            if (patch.files.length) {
              await Session.updatePart(
                trackPart({
                  id: Identifier.ascending("part"),
                  messageID: input.assistantMessage.id,
                  sessionID: input.sessionID,
                  type: "patch" as const,
                  hash: patch.hash,
                  files: patch.files,
                }),
              )
            }
            snapshot = undefined
          }
          const p = await MessageV2.parts(input.assistantMessage.id)
          for (const part of p) {
            if (part.type === "tool" && part.state.status !== "completed" && part.state.status !== "error") {
              await Session.updatePart({
                ...part,
                state: {
                  ...part.state,
                  status: "error",
                  error: "Tool execution aborted",
                  time: {
                    start: Date.now(),
                    end: Date.now(),
                  },
                },
              })
            }
          }
          input.assistantMessage.time.completed = Date.now()
          await Session.updateMessage(input.assistantMessage)
          // Flush any remaining coalesced delta writes before returning
          try {
            await coalescer.flushAll()
          } finally {
            // Clear pending state to prevent memory leak across messages
            coalescer.clear()
          }
          if (needsCompaction) return "compact"
          if (blocked) return "stop"
          if (input.assistantMessage.error) return "stop"
          return "continue"
        }
      },
    }
    return result
  }
}
