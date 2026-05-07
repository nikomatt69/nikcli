import path from "path"
import os from "os"
import fs from "fs/promises"
import z from "zod"
import { Identifier } from "../id/id"
import { MessageV2 } from "./message-v2"
import { Log } from "../util/log"
import { SessionRevert } from "./revert"
import { Session } from "."
import { Agent } from "../agent/agent"
import { Provider } from "../provider/provider"
import { type Tool as AITool, tool, jsonSchema, type ToolCallOptions } from "ai"
import { SessionCompaction } from "./compaction"
import { Bus } from "../bus"
import { ProviderTransform } from "../provider/transform"
import { SystemPrompt } from "./system"
import { Plugin } from "../plugin"
import PROMPT_PLAN from "../session/prompt/plan.txt"
import BUILD_SWITCH from "../session/prompt/build-switch.txt"
import MAX_STEPS from "../session/prompt/max-steps.txt"
import { defer } from "../util/defer"
import { clone } from "remeda"
import { ToolRegistry } from "../tool/registry"
import { MCP } from "../mcp"
import { LSP } from "../lsp"
import { ReadTool } from "../tool/read"
import { ListTool } from "../tool/ls"
import { FileTime } from "../file/time"
import { Flag } from "../flag/flag"
import { ulid } from "ulid"
import { spawn } from "child_process"
import { Command } from "../command"
import { $, fileURLToPath } from "bun"
import { ConfigMarkdown } from "../config/markdown"
import { SessionSummary } from "./summary"
import { NamedError } from "@nikcli-ai/util/error"
import { fn } from "@/util/fn"
import { SessionProcessor } from "./processor"
import { TaskTool } from "@/tool/task"
import { Tool } from "@/tool/tool"
import { PermissionNext } from "@/permission/next"
import { SessionStatus } from "./status"
import { LLM } from "./llm"
import { iife } from "@/util/iife"
import { Shell } from "@/shell/shell"
import { Truncate } from "@/tool/truncation"
import { Context, Effect, Layer, ScopedCache } from "effect"
import { InstanceState, runPromiseWithLayer, runtimeFor, withCurrentInstance, type InstanceContext } from "@/effect"

globalThis.AI_SDK_LOG_WARNINGS = false

const STRUCTURED_OUTPUT_DESCRIPTION = `Use this tool to return your final response in the requested structured format.

IMPORTANT:
- You MUST call this tool exactly once at the end of your response
- The input must be valid JSON matching the required schema
- Complete all necessary research and tool calls BEFORE calling this tool
- This tool provides your final answer - no further actions are taken after calling it`

const STRUCTURED_OUTPUT_SYSTEM_PROMPT = `IMPORTANT: The user has requested structured output. You MUST use the StructuredOutput tool to provide your final response. Do NOT respond with plain text - you MUST call the StructuredOutput tool with your answer formatted according to the schema.`

export namespace SessionPrompt {
  const log = Log.create({ service: "session.prompt" })
  type PromptState = Record<
    string,
    {
      abort: AbortController
      cancelling?: boolean
      callbacks: {
        resolve(input: MessageV2.WithParts): void
        reject(error?: Error): void
      }[]
    }
  >

  function truncateOutput(text: string, options: Truncate.Options = {}, agent?: Agent.Info) {
    return runPromiseWithLayer(
      Truncate.defaultLayer,
      Effect.gen(function* () {
        const truncate = yield* Truncate.Service
        return yield* truncate.output(text, options, agent)
      }),
    )
  }

  function toolRegistryTools(
    model: { providerID: string; modelID: string },
    agent?: Agent.Info,
    options?: { slim?: boolean },
  ) {
    return runPromiseWithLayer(
      ToolRegistry.defaultLayer,
      withCurrentInstance(
        Effect.gen(function* () {
          const registry = yield* ToolRegistry.Service
          return yield* registry.tools(model, agent, options)
        }),
      ),
    )
  }

  function askPermission(input: PermissionNext.AskInput) {
    return runPromiseWithLayer(
      PermissionNext.defaultLayer,
      withCurrentInstance(
        Effect.gen(function* () {
          const permission = yield* PermissionNext.Service
          return yield* permission.ask(input)
        }),
      ),
    )
  }

  function commandGet(name: string) {
    return runPromiseWithLayer(
      Command.defaultLayer,
      withCurrentInstance(
        Effect.gen(function* () {
          const command = yield* Command.Service
          return yield* command.get(name)
        }),
      ),
    )
  }

  function agentGet(name: string) {
    return runPromiseWithLayer(
      Agent.defaultLayer,
      withCurrentInstance(
        Effect.gen(function* () {
          const agent = yield* Agent.Service
          return yield* agent.get(name)
        }),
      ),
    )
  }

  async function agentRequired(name: string) {
    const agent = await agentGet(name)
    if (!agent) throw new Error(`Agent not found: ${name}`)
    return agent
  }

  function agentList() {
    return runPromiseWithLayer(
      Agent.defaultLayer,
      withCurrentInstance(
        Effect.gen(function* () {
          const agent = yield* Agent.Service
          return yield* agent.list()
        }),
      ),
    )
  }

  function defaultAgent() {
    return runPromiseWithLayer(
      Agent.defaultLayer,
      withCurrentInstance(
        Effect.gen(function* () {
          const agent = yield* Agent.Service
          return yield* agent.defaultAgent()
        }),
      ),
    )
  }

  function systemPromptParts(skills: string[] = []) {
    return runPromiseWithLayer(
      SystemPrompt.defaultLayer,
      withCurrentInstance(
        Effect.gen(function* () {
          const systemPrompt = yield* SystemPrompt.Service
          const [activeSkillMessages, environment, custom] = yield* Effect.all(
            [systemPrompt.skills(skills), systemPrompt.environment(), systemPrompt.custom()],
            { concurrency: "unbounded" },
          )
          return {
            activeSkillMessages,
            system: [...environment, ...custom],
          }
        }),
      ),
    )
  }

  function runSummary<A, E>(effect: Effect.Effect<A, E, SessionSummary.Service>) {
    return runPromiseWithLayer(SessionSummary.defaultLayer, withCurrentInstance(effect))
  }

  function runRevert<A, E>(effect: Effect.Effect<A, E, SessionRevert.Service>) {
    return runPromiseWithLayer(SessionRevert.defaultLayer, withCurrentInstance(effect))
  }

  function runCompaction<A, E>(effect: Effect.Effect<A, E, SessionCompaction.Service>) {
    return runPromiseWithLayer(SessionCompaction.defaultLayer, withCurrentInstance(effect))
  }

  function runSession<A, E>(effect: Effect.Effect<A, E, Session.Service>) {
    return runPromiseWithLayer(Session.defaultLayer, withCurrentInstance(effect))
  }

  function sessionGet(sessionID: string) {
    return runSession(
      Effect.gen(function* () {
        const session = yield* Session.Service
        return yield* session.get(sessionID)
      }),
    )
  }

  function sessionTouch(sessionID: string) {
    return runSession(
      Effect.gen(function* () {
        const session = yield* Session.Service
        return yield* session.touch(sessionID)
      }),
    )
  }

  function sessionUpdate(
    sessionID: string,
    editor: (session: Session.Info) => void,
    options?: { touch?: boolean },
  ) {
    return runSession(
      Effect.gen(function* () {
        const session = yield* Session.Service
        return yield* session.update(sessionID, editor, options)
      }),
    )
  }

  function sessionUpdateMessage(message: MessageV2.Info) {
    return runSession(
      Effect.gen(function* () {
        const session = yield* Session.Service
        return yield* session.updateMessage(message)
      }),
    )
  }

  function sessionUpdatePart(part: MessageV2.Part) {
    return runSession(
      Effect.gen(function* () {
        const session = yield* Session.Service
        return yield* session.updatePart(part)
      }),
    )
  }

  function sessionPlan(info: Session.Info) {
    return runSession(
      Effect.gen(function* () {
        const session = yield* Session.Service
        return yield* session.plan(info)
      }),
    )
  }

  function runPlugin<A, E>(effect: Effect.Effect<A, E, Plugin.Service>) {
    return runPromiseWithLayer(Plugin.defaultLayer, withCurrentInstance(effect))
  }

  function runProvider<A, E>(effect: Effect.Effect<A, E, Provider.Service>) {
    return runPromiseWithLayer(Provider.defaultLayer, withCurrentInstance(effect))
  }

  function providerGetModel(providerID: string, modelID: string) {
    return runProvider(
      Effect.gen(function* () {
        const provider = yield* Provider.Service
        return yield* provider.getModel(providerID, modelID)
      }),
    )
  }

  function providerGetSmallModel(providerID: string) {
    return runProvider(
      Effect.gen(function* () {
        const provider = yield* Provider.Service
        return yield* provider.getSmallModel(providerID)
      }),
    )
  }

  function providerDefaultModel() {
    return runProvider(
      Effect.gen(function* () {
        const provider = yield* Provider.Service
        return yield* provider.defaultModel()
      }),
    )
  }

  function runLSP<A, E>(effect: Effect.Effect<A, E, LSP.Service>) {
    return runPromiseWithLayer(LSP.defaultLayer, withCurrentInstance(effect))
  }

  function runMCP<A, E>(effect: Effect.Effect<A, E, MCP.Service>) {
    return runPromiseWithLayer(MCP.defaultLayer, withCurrentInstance(effect))
  }

  function setStatus(sessionID: string, status: SessionStatus.Info) {
    return runPromiseWithLayer(
      SessionStatus.defaultLayer,
      withCurrentInstance(
        Effect.gen(function* () {
          const sessionStatus = yield* SessionStatus.Service
          return yield* sessionStatus.set(sessionID, status)
        }),
      ),
    )
  }

  function currentContext(): Promise<InstanceContext> {
    return Effect.runPromise(withCurrentInstance(InstanceState.context))
  }

  class StateCache extends Context.Tag("SessionPrompt.StateCache")<
    StateCache,
    ScopedCache.ScopedCache<string, PromptState>
  >() {}

  const stateLayer = Layer.scoped(
    StateCache,
    InstanceState.make<PromptState>(() =>
      Effect.gen(function* () {
        const data: PromptState = {}
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            for (const item of Object.values(data)) {
              item.abort.abort()
              for (const callback of item.callbacks) {
                callback.reject()
              }
            }
          }),
        )
        return data
      }),
    ),
  )

  function getStateEffect() {
    return Effect.gen(function* () {
      const cache = yield* StateCache
      return yield* InstanceState.get(cache)
    })
  }

  function getServiceStateEffect() {
    return getStateEffect().pipe(Effect.provide(stateLayer))
  }

  function state(): PromptState {
    return runtimeFor(stateLayer).runSync(withCurrentInstance(getStateEffect()))
  }

  function assertNotBusy(sessionID: string) {
    const match = state()[sessionID]
    if (match) throw new Session.BusyError(sessionID)
  }

  export const PromptInput = z.object({
    sessionID: Identifier.schema("session"),
    messageID: Identifier.schema("message").optional(),
    model: z
      .object({
        providerID: z.string(),
        modelID: z.string(),
      })
      .optional(),
    agent: z.string().optional(),
    noReply: z.boolean().optional(),
    tools: z
      .record(z.string(), z.boolean())
      .optional()
      .describe(
        "@deprecated tools and permissions have been merged, you can set permissions on the session itself now",
      ),
    format: MessageV2.Format.optional(),
    system: z.string().optional(),
    variant: z.string().optional(),
    parts: z.array(
      z.discriminatedUnion("type", [
        MessageV2.TextPart.omit({
          messageID: true,
          sessionID: true,
        })
          .partial({
            id: true,
          })
          .meta({
            ref: "TextPartInput",
          }),
        MessageV2.FilePart.omit({
          messageID: true,
          sessionID: true,
        })
          .partial({
            id: true,
          })
          .meta({
            ref: "FilePartInput",
          }),
        MessageV2.AgentPart.omit({
          messageID: true,
          sessionID: true,
        })
          .partial({
            id: true,
          })
          .meta({
            ref: "AgentPartInput",
          }),
        MessageV2.SubtaskPart.omit({
          messageID: true,
          sessionID: true,
        })
          .partial({
            id: true,
          })
          .meta({
            ref: "SubtaskPartInput",
          }),
      ]),
    ),
  })
  export type PromptInput = z.infer<typeof PromptInput>

  export interface Interface {
    assertNotBusy(sessionID: string): Effect.Effect<void>
    prompt(input: PromptInput): Effect.Effect<Awaited<ReturnType<typeof prompt>>, unknown>
    resolvePromptParts(template: string): Effect.Effect<PromptInput["parts"], unknown>
    cancel(sessionID: string): Effect.Effect<void>
    loop(sessionID: string): Effect.Effect<Awaited<ReturnType<typeof loop>>, unknown>
    shell(input: ShellInput): Effect.Effect<Awaited<ReturnType<typeof shell>>, unknown>
    command(input: CommandInput): Effect.Effect<Awaited<ReturnType<typeof command>>, unknown>
  }

  export class Service extends Context.Tag("SessionPrompt.Service")<Service, Interface>() {}

  const prompt = fn(PromptInput, async (input) => {
    const session = await sessionGet(input.sessionID)
    await runRevert(
      Effect.gen(function* () {
        const revert = yield* SessionRevert.Service
        yield* revert.cleanup(session)
      }),
    )

    const message = await createUserMessage(input)
    await sessionTouch(input.sessionID)

    const permissions: PermissionNext.Ruleset = []
    for (const [tool, enabled] of Object.entries(input.tools ?? {})) {
      permissions.push({
        permission: tool,
        action: enabled ? "allow" : "deny",
        pattern: "*",
      })
    }
    if (permissions.length > 0) {
      session.permission = permissions
      await sessionUpdate(session.id, (draft) => {
        draft.permission = permissions
      })
    }

    if (input.noReply === true) {
      return message
    }

    return loop(input.sessionID)
  })

  async function resolvePromptPartsImpl(ctx: InstanceContext, template: string): Promise<PromptInput["parts"]> {
    const parts: PromptInput["parts"] = [
      {
        type: "text",
        text: template,
      },
    ]
    const files = ConfigMarkdown.files(template)
    const seen = new Set<string>()
    await Promise.all(
      files.map(async (match) => {
        const name = match[1]
        if (seen.has(name)) return
        seen.add(name)
        const filepath = name.startsWith("~/")
          ? path.join(os.homedir(), name.slice(2))
          : path.resolve(ctx.worktree, name)

        const stats = await fs.stat(filepath).catch(() => undefined)
        if (!stats) {
          const agent = await agentGet(name)
          if (agent) {
            parts.push({
              type: "agent",
              name: agent.name,
            })
          }
          return
        }

        if (stats.isDirectory()) {
          parts.push({
            type: "file",
            url: `file://${filepath}`,
            filename: name,
            mime: "application/x-directory",
          })
          return
        }

        parts.push({
          type: "file",
          url: `file://${filepath}`,
          filename: name,
          mime: "text/plain",
        })
      }),
    )
    return parts
  }

  async function resolvePromptParts(template: string): Promise<PromptInput["parts"]> {
    return resolvePromptPartsImpl(await currentContext(), template)
  }

  function start(sessionID: string) {
    const s = state()
    if (s[sessionID]) return
    const controller = new AbortController()
    s[sessionID] = {
      abort: controller,
      callbacks: [],
    }
    return controller
  }

  async function finish(sessionID: string, controller: AbortController) {
    const s = state()
    const match = s[sessionID]
    if (!match || match.abort !== controller) return
    for (const item of match.callbacks) {
      item.reject()
    }
    delete s[sessionID]
    await setStatus(sessionID, { type: "idle" })
  }

  const cancel = (() => {
    const log = Log.create({ service: "session.prompt" })
    return function cancel(sessionID: string) {
      log.info("cancel", { sessionID })
      const s = state()
      const match = s[sessionID]
      if (!match) return
      match.abort.abort()
      match.cancelling = true
      for (const item of match.callbacks) {
        item.reject()
      }
      match.callbacks = []
      return
    }
  })()

  const loop = fn(Identifier.schema("session"), async (sessionID) => {
    const controller = start(sessionID)
    if (!controller) {
      return new Promise<MessageV2.WithParts>((resolve, reject) => {
        const callbacks = state()[sessionID].callbacks
        callbacks.push({ resolve, reject })
      })
    }
    const abort = controller.signal

    await using _ = defer(() => finish(sessionID, controller))
    const ctx = await currentContext()

    // Structured output state
    // Note: On session resumption, state is reset but format is preserved
    // on the user message and will be retrieved from lastUser below
    let structuredOutput: unknown | undefined
    let structuredOutputUserID: string | undefined
    let structuredOutputRetries = 0

    let step = 0
    while (true) {
      await setStatus(sessionID, { type: "busy" })
      log.info("loop", { step, sessionID })
      if (abort.aborted) break
      const session = await sessionGet(sessionID)
      let msgs = await MessageV2.filterCompacted(MessageV2.stream(sessionID))

      let lastUser: MessageV2.User | undefined
      let lastAssistant: MessageV2.Assistant | undefined
      let lastFinished: MessageV2.Assistant | undefined
      let tasks: (MessageV2.CompactionPart | MessageV2.SubtaskPart)[] = []
      for (let i = msgs.length - 1; i >= 0; i--) {
        const msg = msgs[i]
        if (!lastUser && msg.info.role === "user") lastUser = msg.info as MessageV2.User
        if (!lastAssistant && msg.info.role === "assistant") lastAssistant = msg.info as MessageV2.Assistant
        if (!lastFinished && msg.info.role === "assistant" && msg.info.finish)
          lastFinished = msg.info as MessageV2.Assistant
        if (lastUser && lastFinished) break
        const task = msg.parts.filter((part) => part.type === "compaction" || part.type === "subtask")
        if (task && !lastFinished) {
          tasks.push(...task)
        }
      }

      if (!lastUser) throw new Error("No user message found in stream. This should never happen.")
      if (structuredOutputUserID !== lastUser.id) {
        structuredOutputUserID = lastUser.id
        structuredOutputRetries = 0
        structuredOutput = undefined
      }
      if (
        lastAssistant?.finish &&
        !["tool-calls", "unknown"].includes(lastAssistant.finish) &&
        lastUser.id < lastAssistant.id
      ) {
        // Check if new messages arrived while we were running
        // This handles the race condition in prompt where messages can arrive
        // while the runner is transitioning between states
        const latestMsgs = await MessageV2.filterCompacted(MessageV2.stream(sessionID))
        const newUserMsg = latestMsgs.findLast((m) => m.info.role === "user" && m.info.id > lastAssistant!.id)

        // If a new user message arrived, continue the loop to process it
        if (newUserMsg) {
          log.info("detected new message during exit, continuing loop", {
            sessionID,
            lastAssistantId: lastAssistant!.id,
            newMsgId: newUserMsg.info.id,
          })
          step = 0
          continue
        }

        log.info("exiting loop", { sessionID })
        break
      }

      step++
      if (step === 1)
        ensureTitle({
          session,
          modelID: lastUser.model.modelID,
          providerID: lastUser.model.providerID,
          history: msgs,
        })

      const model = await providerGetModel(lastUser.model.providerID, lastUser.model.modelID)
      const task = tasks.pop()

      if (task?.type === "subtask") {
        const taskTool = await TaskTool.init()
        const taskModel = task.model ? await providerGetModel(task.model.providerID, task.model.modelID) : model
        const assistantMessage = (await sessionUpdateMessage({
          id: Identifier.ascending("message"),
          role: "assistant",
          parentID: lastUser.id,
          sessionID,
          mode: task.agent,
          agent: task.agent,
          path: {
            cwd: ctx.directory,
            root: ctx.worktree,
          },
          cost: 0,
          tokens: {
            input: 0,
            output: 0,
            reasoning: 0,
            cache: { read: 0, write: 0 },
          },
          modelID: taskModel.id,
          providerID: taskModel.providerID,
          time: {
            created: Date.now(),
          },
        })) as MessageV2.Assistant
        const part = (await sessionUpdatePart({
          id: Identifier.ascending("part"),
          messageID: assistantMessage.id,
          sessionID: assistantMessage.sessionID,
          type: "tool",
          callID: ulid(),
          tool: TaskTool.id,
          state: {
            status: "running",
            input: {
              prompt: task.prompt,
              description: task.description,
              subagent_type: task.agent,
              command: task.command,
              background: task.background,
            },
            time: {
              start: Date.now(),
            },
          },
        })) as MessageV2.ToolPart

        const taskArgs = {
          prompt: task.prompt,
          description: task.description,
          subagent_type: task.agent,
          command: task.command,
          background: task.background,
        }
        await runPlugin(
          Effect.gen(function* () {
            const plugin = yield* Plugin.Service
            yield* plugin.trigger(
              "tool.execute.before",
              {
                tool: "task",
                sessionID,
                callID: part.id,
              },
              { args: taskArgs },
            )
          }),
        )
        let executionError: Error | undefined
        const taskAgent = await agentRequired(task.agent)
        const taskCtx: Tool.Context = {
          agent: task.agent,
          messageID: assistantMessage.id,
          sessionID: sessionID,
          abort,
          callID: part.callID,
          extra: {
            bypassAgentCheck: true,
            backgroundSource: task.background === true ? "model-subtask" : undefined,
          },
          async metadata(input) {
            await sessionUpdatePart({
              ...part,
              type: "tool",
              state: {
                ...part.state,
                ...input,
              },
            } satisfies MessageV2.ToolPart)
          },
          async ask(req) {
            await askPermission({
              ...req,
              sessionID: sessionID,
              ruleset: PermissionNext.merge(taskAgent.permission, session.permission ?? []),
            })
          },
        }
        const result = await taskTool.executeAsync(taskArgs, taskCtx).catch((error: unknown) => {
          executionError = error instanceof Error ? error : new Error(String(error))
          log.error("subtask execution failed", { error, agent: task.agent, description: task.description })
          return undefined
        })
        await runPlugin(
          Effect.gen(function* () {
            const plugin = yield* Plugin.Service
            yield* plugin.trigger(
              "tool.execute.after",
              {
                tool: "task",
                sessionID,
                callID: part.id,
              },
              result,
            )
          }),
        )
        assistantMessage.finish = "tool-calls"
        assistantMessage.time.completed = Date.now()
        await sessionUpdateMessage(assistantMessage)
        if (result && part.state.status === "running") {
          await sessionUpdatePart({
            ...part,
            state: {
              status: "completed",
              input: part.state.input,
              title: result.title,
              metadata: result.metadata,
              output: result.output,
              attachments: result.attachments,
              time: {
                ...part.state.time,
                end: Date.now(),
              },
            },
          } satisfies MessageV2.ToolPart)
        }
        if (!result) {
          await sessionUpdatePart({
            ...part,
            state: {
              status: "error",
              error: executionError ? `Tool execution failed: ${executionError.message}` : "Tool execution failed",
              time: {
                start: part.state.status === "running" ? part.state.time.start : Date.now(),
                end: Date.now(),
              },
              metadata: part.metadata,
              input: part.state.input,
            },
          } satisfies MessageV2.ToolPart)
        }

        if (task.command) {
          const summaryUserMsg: MessageV2.User = {
            id: Identifier.ascending("message"),
            sessionID,
            role: "user",
            time: {
              created: Date.now(),
            },
            agent: lastUser.agent,
            model: lastUser.model,
          }
          await sessionUpdateMessage(summaryUserMsg)
          await sessionUpdatePart({
            id: Identifier.ascending("part"),
            messageID: summaryUserMsg.id,
            sessionID,
            type: "text",
            text: "Summarize the task tool output above and continue with your task.",
            synthetic: true,
          } satisfies MessageV2.TextPart)
        }

        continue
      }

      if (task?.type === "compaction") {
        const result = await runCompaction(
          Effect.gen(function* () {
            const compaction = yield* SessionCompaction.Service
            return yield* compaction.process({
              messages: msgs,
              parentID: lastUser.id,
              abort,
              sessionID,
              auto: task.auto,
            })
          }),
        )
        if (result === "stop") break
        continue
      }

      if (
        lastFinished &&
        lastFinished.summary !== true &&
        (await runCompaction(
          Effect.gen(function* () {
            const compaction = yield* SessionCompaction.Service
            return yield* compaction.isOverflow({ tokens: lastFinished.tokens, model })
          }),
        ))
      ) {
        await runCompaction(
          Effect.gen(function* () {
            const compaction = yield* SessionCompaction.Service
            yield* compaction.create({
              sessionID,
              agent: lastUser.agent,
              model: lastUser.model,
              auto: true,
            })
          }),
        )
        continue
      }

      const agent = await agentRequired(lastUser.agent)
      const maxSteps = agent.steps ?? Infinity
      const isLastStep = step >= maxSteps
      msgs = await insertReminders({
        messages: msgs,
        agent,
        session,
      })

      const processor = SessionProcessor.create({
        assistantMessage: (await sessionUpdateMessage({
          id: Identifier.ascending("message"),
          parentID: lastUser.id,
          role: "assistant",
          mode: agent.name,
          agent: agent.name,
          path: {
            cwd: ctx.directory,
            root: ctx.worktree,
          },
          cost: 0,
          tokens: {
            input: 0,
            output: 0,
            reasoning: 0,
            cache: { read: 0, write: 0 },
          },
          modelID: model.id,
          providerID: model.providerID,
          time: {
            created: Date.now(),
          },
          sessionID,
        })) as MessageV2.Assistant,
        sessionID: sessionID,
        model,
        abort,
      })

      const lastUserMsg = msgs.findLast((m) => m.info.role === "user")
      const bypassAgentCheck = lastUserMsg?.parts.some((p) => p.type === "agent") ?? false

      const tools = await resolveTools({
        agent,
        session,
        model,
        tools: lastUser.tools,
        processor,
        bypassAgentCheck,
      })

      // Inject StructuredOutput tool if JSON schema mode is enabled
      if (lastUser.format?.type === "json_schema") {
        tools["StructuredOutput"] = createStructuredOutputTool({
          schema: lastUser.format.schema,
          onSuccess(output) {
            structuredOutput = output
          },
        })
      }

      if (step === 1) {
        void runSummary(
          Effect.gen(function* () {
            const summary = yield* SessionSummary.Service
            yield* summary.summarize({
              sessionID: sessionID,
              messageID: lastUser.id,
            })
          }),
        )
      }

      const sessionMessages = clone(msgs)

      if (step > 1 && lastFinished) {
        for (const msg of sessionMessages) {
          if (msg.info.role !== "user" || msg.info.id <= lastFinished.id) continue
          for (const part of msg.parts) {
            if (part.type !== "text" || part.ignored || part.synthetic) continue
            if (!part.text.trim()) continue
            part.text = [
              "<system-reminder>",
              "The user sent the following message:",
              part.text,
              "",
              "Please address this message and continue with your tasks.",
              "</system-reminder>",
            ].join("\n")
          }
        }
      }

      await runPlugin(
        Effect.gen(function* () {
          const plugin = yield* Plugin.Service
          yield* plugin.trigger("experimental.chat.messages.transform", {}, { messages: sessionMessages })
        }),
      )

      const systemPrompt = await systemPromptParts(session.skills ?? [])

      // Build system prompt, adding structured output instructions if needed
      const system = [...systemPrompt.system]
      const format: MessageV2.OutputFormat = lastUser.format ?? { type: "text" }
      if (format.type === "json_schema") {
        system.push(STRUCTURED_OUTPUT_SYSTEM_PROMPT)
      }

      const result = await processor.process({
        user: lastUser,
        agent,
        abort,
        sessionID,
        system,
        messages: [
          ...systemPrompt.activeSkillMessages.map((content) => ({ role: "user" as const, content })),
          ...MessageV2.toModelMessages(sessionMessages, model),
          ...(isLastStep
            ? [
                {
                  role: "assistant" as const,
                  content: MAX_STEPS,
                },
              ]
            : []),
        ],
        tools,
        model,
        toolChoice: format.type === "json_schema" ? "required" : undefined,
      })

      // If structured output was captured, save it and exit immediately.
      // This takes priority because the StructuredOutput tool was called successfully.
      if (structuredOutput !== undefined) {
        processor.message.structured = structuredOutput
        processor.message.finish = processor.message.finish ?? "stop"
        await sessionUpdateMessage(processor.message)
        break
      }

      // If the model stopped without the StructuredOutput tool, return a structured output error.
      const modelFinished = processor.message.finish && !["tool-calls", "unknown"].includes(processor.message.finish)
      if (modelFinished && !processor.message.error && format.type === "json_schema") {
        if (structuredOutputRetries < format.retryCount) {
          structuredOutputRetries++
          const retryMsg = await sessionUpdateMessage({
            id: Identifier.ascending("message"),
            role: "user",
            sessionID,
            time: {
              created: Date.now(),
            },
            agent: lastUser.agent,
            model: lastUser.model,
            system: lastUser.system,
            tools: lastUser.tools,
            format: lastUser.format,
            variant: lastUser.variant,
          })
          await sessionUpdatePart({
            id: Identifier.ascending("part"),
            messageID: retryMsg.id,
            sessionID,
            type: "text",
            synthetic: true,
            text: "The previous response did not call the StructuredOutput tool. Retry and call StructuredOutput exactly once with valid JSON matching the requested schema.",
            time: {
              start: Date.now(),
              end: Date.now(),
            },
          })
          structuredOutputUserID = retryMsg.id
          step = 0
          continue
        }
        processor.message.error = new MessageV2.StructuredOutputError({
          message: "Model did not produce structured output",
          retries: structuredOutputRetries,
        }).toObject()
        await sessionUpdateMessage(processor.message)
        break
      }

      if (result === "stop") break
      if (result === "compact") {
        await runCompaction(
          Effect.gen(function* () {
            const compaction = yield* SessionCompaction.Service
            yield* compaction.create({
              sessionID,
              agent: lastUser.agent,
              model: lastUser.model,
              auto: true,
            })
          }),
        )
      }
      continue
    }
    void runCompaction(
      Effect.gen(function* () {
        const compaction = yield* SessionCompaction.Service
        yield* compaction.prune({ sessionID })
      }),
    )
    for await (const item of MessageV2.stream(sessionID)) {
      if (item.info.role === "user") continue
      const queued = state()[sessionID]?.callbacks ?? []
      for (const q of queued) {
        q.resolve(item)
      }
      return item
    }
    throw new Error("Impossible")
  })

  async function lastModel(sessionID: string) {
    for await (const item of MessageV2.stream(sessionID)) {
      if (item.info.role === "user" && item.info.model) return item.info.model
    }
    return providerDefaultModel()
  }

  /** @internal Exported for testing */
  export async function resolveTools(input: {
    agent: Agent.Info
    model: Provider.Model
    session: Session.Info
    tools?: Record<string, boolean>
    processor: SessionProcessor.Info
    bypassAgentCheck: boolean
  }) {
    using _ = log.time("resolveTools")
    const tools: Record<string, AITool> = {}

    const context = (args: any, options: ToolCallOptions): Tool.Context => ({
      sessionID: input.session.id,
      abort: options.abortSignal!,
      messageID: input.processor.message.id,
      callID: options.toolCallId,
      extra: { model: input.model, bypassAgentCheck: input.bypassAgentCheck },
      agent: input.agent.name,
      metadata: async (val: { title?: string; metadata?: any }) => {
        const match = input.processor.partFromToolCall(options.toolCallId)
        if (match && match.state.status === "running") {
          await sessionUpdatePart({
            ...match,
            state: {
              title: val.title,
              metadata: val.metadata,
              status: "running",
              input: args,
              time: {
                start: Date.now(),
              },
            },
          })
        }
      },
      async ask(req) {
        await askPermission({
          ...req,
          sessionID: input.session.id,
          tool: { messageID: input.processor.message.id, callID: options.toolCallId },
          ruleset: PermissionNext.merge(input.agent.permission, input.session.permission ?? []),
        })
      },
    })

    for (const item of await toolRegistryTools(
      { modelID: input.model.api.id, providerID: input.model.providerID },
      input.agent,
    )) {
      const schema = ProviderTransform.schema(input.model, z.toJSONSchema(item.parameters))
      tools[item.id] = tool({
        id: item.id as any,
        description: item.description,
        inputSchema: jsonSchema(schema as any),
        async execute(args, options) {
          const ctx = context(args, options)
          await runPlugin(
            Effect.gen(function* () {
              const plugin = yield* Plugin.Service
              yield* plugin.trigger(
                "tool.execute.before",
                {
                  tool: item.id,
                  sessionID: ctx.sessionID,
                  callID: ctx.callID,
                },
                {
                  args,
                },
              )
            }),
          )
          const result = await item.executeAsync(args, ctx)
          await runPlugin(
            Effect.gen(function* () {
              const plugin = yield* Plugin.Service
              yield* plugin.trigger(
                "tool.execute.after",
                {
                  tool: item.id,
                  sessionID: ctx.sessionID,
                  callID: ctx.callID,
                },
                result,
              )
            }),
          )
          return result
        },
        toModelOutput(result) {
          return {
            type: "text",
            value: result.output,
          }
        },
      })
    }

    const mcpTools = await runMCP(
      Effect.gen(function* () {
        const mcp = yield* MCP.Service
        return yield* mcp.tools()
      }),
    )
    for (const [key, item] of Object.entries(mcpTools)) {
      const execute = item.execute
      if (!execute) continue

      item.execute = async (args, opts) => {
        const ctx = context(args, opts)

        await runPlugin(
          Effect.gen(function* () {
            const plugin = yield* Plugin.Service
            yield* plugin.trigger(
              "tool.execute.before",
              {
                tool: key,
                sessionID: ctx.sessionID,
                callID: opts.toolCallId,
              },
              {
                args,
              },
            )
          }),
        )

        await ctx.ask({
          permission: key,
          metadata: {},
          patterns: ["*"],
          always: ["*"],
        })

        const result = await execute(args, opts)

        await runPlugin(
          Effect.gen(function* () {
            const plugin = yield* Plugin.Service
            yield* plugin.trigger(
              "tool.execute.after",
              {
                tool: key,
                sessionID: ctx.sessionID,
                callID: opts.toolCallId,
              },
              result,
            )
          }),
        )

        const textParts: string[] = []
        const attachments: MessageV2.FilePart[] = []

        for (const contentItem of result.content) {
          if (contentItem.type === "text") {
            textParts.push(contentItem.text)
          } else if (contentItem.type === "image") {
            attachments.push({
              id: Identifier.ascending("part"),
              sessionID: input.session.id,
              messageID: input.processor.message.id,
              type: "file",
              mime: contentItem.mimeType,
              url: `data:${contentItem.mimeType};base64,${contentItem.data}`,
            })
          } else if (contentItem.type === "resource") {
            const { resource } = contentItem
            if (resource.text) {
              textParts.push(resource.text)
            }
            if (resource.blob) {
              attachments.push({
                id: Identifier.ascending("part"),
                sessionID: input.session.id,
                messageID: input.processor.message.id,
                type: "file",
                mime: resource.mimeType ?? "application/octet-stream",
                url: `data:${resource.mimeType ?? "application/octet-stream"};base64,${resource.blob}`,
                filename: resource.uri,
              })
            }
          }
        }

        const truncated = await truncateOutput(textParts.join("\n\n"), {}, input.agent)
        const metadata = {
          ...(result.metadata ?? {}),
          truncated: truncated.truncated,
          ...(truncated.truncated && { outputPath: truncated.outputPath }),
        }

        return {
          title: "",
          metadata,
          output: truncated.content,
          attachments,
          content: result.content,
        }
      }
      item.toModelOutput = (result) => {
        return {
          type: "text",
          value: result.output,
        }
      }
      tools[key] = item
    }

    const { Connectors } = await import("@/connectors")
    for (const [key, item] of Object.entries(await Connectors.tools())) {
      const execute = item.execute
      if (!execute) continue

      item.execute = async (args, opts) => {
        const ctx = context(args, opts)

        await runPlugin(
          Effect.gen(function* () {
            const plugin = yield* Plugin.Service
            yield* plugin.trigger(
              "tool.execute.before",
              {
                tool: key,
                sessionID: ctx.sessionID,
                callID: opts.toolCallId,
              },
              {
                args,
              },
            )
          }),
        )

        await ctx.ask({
          permission: key,
          metadata: {},
          patterns: ["*"],
          always: ["*"],
        })

        const result = await execute(args, opts)

        await runPlugin(
          Effect.gen(function* () {
            const plugin = yield* Plugin.Service
            yield* plugin.trigger(
              "tool.execute.after",
              {
                tool: key,
                sessionID: ctx.sessionID,
                callID: opts.toolCallId,
              },
              result,
            )
          }),
        )

        const textOutput = typeof result === "string" ? result : JSON.stringify(result, null, 2)
        const truncated = await truncateOutput(textOutput, {}, input.agent)

        return {
          title: "",
          metadata: { truncated: truncated.truncated },
          output: truncated.content,
          content: [{ type: "text", text: truncated.content }],
        }
      }
      item.toModelOutput = (result) => {
        return {
          type: "text",
          value: result.output,
        }
      }
      tools[key] = item
    }

    return tools
  }

  /** @internal Exported for testing */
  export function createStructuredOutputTool(input: {
    schema: Record<string, any>
    onSuccess: (output: unknown) => void
  }): AITool {
    // Remove $schema property if present (not needed for tool input)
    const { $schema, ...toolSchema } = input.schema

    return tool({
      id: "StructuredOutput" as any,
      description: STRUCTURED_OUTPUT_DESCRIPTION,
      inputSchema: jsonSchema(toolSchema as any),
      async execute(args) {
        // AI SDK validates args against inputSchema before calling execute()
        input.onSuccess(args)
        return {
          output: "Structured output captured successfully.",
          title: "Structured Output",
          metadata: { valid: true },
        }
      },
      toModelOutput(result) {
        return {
          type: "text",
          value: result.output,
        }
      },
    })
  }

  async function createUserMessage(input: PromptInput) {
    const agent = await agentRequired(input.agent ?? (await defaultAgent()))

    const model = input.model ?? agent.model ?? (await lastModel(input.sessionID))
    const full =
      !input.variant && agent.variant
        ? await providerGetModel(model.providerID, model.modelID).catch(() => undefined)
        : undefined
    const variant = input.variant ?? (agent.variant && full?.variants?.[agent.variant] ? agent.variant : undefined)

    const info: MessageV2.Info = {
      id: input.messageID ?? Identifier.ascending("message"),
      role: "user",
      sessionID: input.sessionID,
      time: {
        created: Date.now(),
      },
      tools: input.tools,
      agent: agent.name,
      model,
      system: input.system,
      format: input.format,
      variant,
    }

    const parts = await Promise.all(
      input.parts.map(async (part): Promise<MessageV2.Part[]> => {
        if (part.type === "file") {
          if (part.source?.type === "resource") {
            const { clientName, uri } = part.source
            log.info("mcp resource", { clientName, uri, mime: part.mime })

            const pieces: MessageV2.Part[] = [
              {
                id: Identifier.ascending("part"),
                messageID: info.id,
                sessionID: input.sessionID,
                type: "text",
                synthetic: true,
                text: `Reading MCP resource: ${part.filename} (${uri})`,
              },
            ]

            try {
              const resourceContent = await runMCP(
                Effect.gen(function* () {
                  const mcp = yield* MCP.Service
                  return yield* mcp.readResource(clientName, uri)
                }),
              )
              if (!resourceContent) {
                throw new Error(`Resource not found: ${clientName}/${uri}`)
              }

              const contents = Array.isArray(resourceContent.contents)
                ? resourceContent.contents
                : [resourceContent.contents]

              for (const content of contents) {
                if ("text" in content && content.text) {
                  pieces.push({
                    id: Identifier.ascending("part"),
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: content.text as string,
                  })
                } else if ("blob" in content && content.blob) {
                  const mimeType = "mimeType" in content ? content.mimeType : part.mime
                  pieces.push({
                    id: Identifier.ascending("part"),
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: `[Binary content: ${mimeType}]`,
                  })
                }
              }

              pieces.push({
                ...part,
                id: part.id ?? Identifier.ascending("part"),
                messageID: info.id,
                sessionID: input.sessionID,
              })
            } catch (error: unknown) {
              log.error("failed to read MCP resource", { error, clientName, uri })
              const message = error instanceof Error ? error.message : String(error)
              pieces.push({
                id: Identifier.ascending("part"),
                messageID: info.id,
                sessionID: input.sessionID,
                type: "text",
                synthetic: true,
                text: `Failed to read MCP resource ${part.filename}: ${message}`,
              })
            }

            return pieces
          }
          const url = new URL(part.url)
          switch (url.protocol) {
            case "data:":
              if (part.mime === "text/plain") {
                const commaIndex = part.url.indexOf(",")
                const metadata = commaIndex === -1 ? part.url : part.url.slice(0, commaIndex)
                const payload = commaIndex === -1 ? "" : part.url.slice(commaIndex + 1)
                const text = decodeDataUrlTextPayload(metadata, payload)
                return [
                  {
                    id: Identifier.ascending("part"),
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: `Called the Read tool with the following input: ${JSON.stringify({ filePath: part.filename })}`,
                  },
                  {
                    id: Identifier.ascending("part"),
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text,
                  },
                  {
                    ...part,
                    id: part.id ?? Identifier.ascending("part"),
                    messageID: info.id,
                    sessionID: input.sessionID,
                  },
                ]
              }
              break
            case "file:":
              log.info("file", { mime: part.mime })
              const filepath = fileURLToPath(part.url)
              const stat = await Bun.file(filepath).stat()

              if (stat.isDirectory()) {
                part.mime = "application/x-directory"
              }

              if (part.mime === "text/plain") {
                let offset: number | undefined = undefined
                let limit: number | undefined = undefined
                const range = {
                  start: url.searchParams.get("start"),
                  end: url.searchParams.get("end"),
                }
                if (range.start != null) {
                  const filePathURI = part.url.split("?")[0]
                  let start = parseInt(range.start)
                  let end = range.end ? parseInt(range.end) : undefined
                  if (start === end) {
                    const symbols = await runLSP(
                      Effect.gen(function* () {
                        const lsp = yield* LSP.Service
                        return yield* lsp.documentSymbol(filePathURI)
                      }),
                    )
                    for (const symbol of symbols) {
                      let range: LSP.Range | undefined
                      if ("range" in symbol) {
                        range = symbol.range
                      } else if ("location" in symbol) {
                        range = symbol.location.range
                      }
                      if (range?.start?.line && range?.start?.line === start) {
                        start = range.start.line
                        end = range?.end?.line ?? start
                        break
                      }
                    }
                  }
                  offset = Math.max(start, 1)
                  if (end) {
                    limit = end - (offset - 1)
                  }
                }
                const args = { filePath: filepath, offset, limit }

                const pieces: MessageV2.Part[] = [
                  {
                    id: Identifier.ascending("part"),
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: `Called the Read tool with the following input: ${JSON.stringify(args)}`,
                  },
                ]

                try {
                  const tool = await ReadTool.init()
                  const model = await providerGetModel(info.model.providerID, info.model.modelID)
                  const readCtx: Tool.Context = {
                    sessionID: input.sessionID,
                    abort: new AbortController().signal,
                    agent: input.agent!,
                    messageID: info.id,
                    extra: { bypassCwdCheck: true, model },
                    metadata: async () => {},
                    ask: async () => {},
                  }
                  const result = await tool.executeAsync(args, readCtx)
                  pieces.push({
                    id: Identifier.ascending("part"),
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: result.output,
                  })
                  if (result.attachments?.length) {
                    pieces.push(
                      ...result.attachments.map((attachment) => ({
                        ...attachment,
                        synthetic: true,
                        filename: attachment.filename ?? part.filename,
                        messageID: info.id,
                        sessionID: input.sessionID,
                      })),
                    )
                  } else {
                    pieces.push({
                      ...part,
                      id: part.id ?? Identifier.ascending("part"),
                      messageID: info.id,
                      sessionID: input.sessionID,
                    })
                  }
                } catch (error) {
                  log.error("failed to read file", { error: String(error) })
                  const message = error instanceof Error ? error.message : String(error)
                  Bus.publish(Session.Event.Error, {
                    sessionID: input.sessionID,
                    error: new NamedError.Unknown({
                      message,
                    }).toObject(),
                  })
                  pieces.push({
                    id: Identifier.ascending("part"),
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: `Read tool failed to read ${filepath} with the following error: ${message}`,
                  })
                }

                return pieces
              }

              if (part.mime === "application/x-directory") {
                const args = { path: filepath }
                const listCtx: Tool.Context = {
                  sessionID: input.sessionID,
                  abort: new AbortController().signal,
                  agent: input.agent!,
                  messageID: info.id,
                  extra: { bypassCwdCheck: true },
                  metadata: async () => {},
                  ask: async () => {},
                }
                const result = await ListTool.init().then((t) => t.executeAsync(args, listCtx))
                return [
                  {
                    id: Identifier.ascending("part"),
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: `Called the list tool with the following input: ${JSON.stringify(args)}`,
                  },
                  {
                    id: Identifier.ascending("part"),
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: result.output,
                  },
                  {
                    ...part,
                    id: part.id ?? Identifier.ascending("part"),
                    messageID: info.id,
                    sessionID: input.sessionID,
                  },
                ]
              }

              const file = Bun.file(filepath)
              await FileTime.read(input.sessionID, filepath)
              return [
                {
                  id: Identifier.ascending("part"),
                  messageID: info.id,
                  sessionID: input.sessionID,
                  type: "text",
                  text: `Called the Read tool with the following input: {"filePath":"${filepath}"}`,
                  synthetic: true,
                },
                {
                  id: part.id ?? Identifier.ascending("part"),
                  messageID: info.id,
                  sessionID: input.sessionID,
                  type: "file",
                  url: `data:${part.mime};base64,` + Buffer.from(await file.bytes()).toString("base64"),
                  mime: part.mime,
                  filename: part.filename!,
                  source: part.source,
                },
              ]
          }
        }

        if (part.type === "agent") {
          const perm = PermissionNext.evaluate("task", part.name, agent.permission)
          const hint = perm.action === "deny" ? " . Invoked by user; guaranteed to exist." : ""
          return [
            {
              id: Identifier.ascending("part"),
              ...part,
              messageID: info.id,
              sessionID: input.sessionID,
            },
            {
              id: Identifier.ascending("part"),
              messageID: info.id,
              sessionID: input.sessionID,
              type: "text",
              synthetic: true,
              text:
                " Use the above message and context to generate a prompt and call the task tool with subagent: " +
                part.name +
                hint,
            },
          ]
        }

        return [
          {
            id: Identifier.ascending("part"),
            ...part,
            messageID: info.id,
            sessionID: input.sessionID,
          },
        ]
      }),
    ).then((x) => x.flat())

    await runPlugin(
      Effect.gen(function* () {
        const plugin = yield* Plugin.Service
        yield* plugin.trigger(
          "chat.message",
          {
            sessionID: input.sessionID,
            agent: input.agent,
            model: input.model,
            messageID: input.messageID,
            variant: input.variant,
          },
          {
            message: info,
            parts,
          },
        )
      }),
    )

    await sessionUpdateMessage(info)
    for (const part of parts) {
      await sessionUpdatePart(part)
    }

    return {
      info,
      parts,
    }
  }

  async function insertReminders(input: { messages: MessageV2.WithParts[]; agent: Agent.Info; session: Session.Info }) {
    const userMessage = input.messages.findLast((msg) => msg.info.role === "user")
    if (!userMessage) return input.messages

    if (!Flag.NIKCLI_EXPERIMENTAL_PLAN_MODE) {
      if (input.agent.name === "plan") {
        userMessage.parts.push({
          id: Identifier.ascending("part"),
          messageID: userMessage.info.id,
          sessionID: userMessage.info.sessionID,
          type: "text",
          text: PROMPT_PLAN,
          synthetic: true,
        })
      }
      const wasPlan = input.messages.some((msg) => msg.info.role === "assistant" && msg.info.agent === "plan")
      if (wasPlan && input.agent.name === "build") {
        userMessage.parts.push({
          id: Identifier.ascending("part"),
          messageID: userMessage.info.id,
          sessionID: userMessage.info.sessionID,
          type: "text",
          text: BUILD_SWITCH,
          synthetic: true,
        })
      }
      return input.messages
    }

    const assistantMessage = input.messages.findLast((msg) => msg.info.role === "assistant")

    if (input.agent.name !== "plan" && assistantMessage?.info.agent === "plan") {
      const plan = await sessionPlan(input.session)
      const exists = await Bun.file(plan).exists()
      if (exists) {
        const part = await sessionUpdatePart({
          id: Identifier.ascending("part"),
          messageID: userMessage.info.id,
          sessionID: userMessage.info.sessionID,
          type: "text",
          text:
            BUILD_SWITCH + "\n\n" + `A plan file exists at ${plan}. You should execute on the plan defined within it`,
          synthetic: true,
        })
        userMessage.parts.push(part)
      }
      return input.messages
    }

    if (input.agent.name === "plan" && assistantMessage?.info.agent !== "plan") {
      const plan = await sessionPlan(input.session)
      const exists = await Bun.file(plan).exists()
      if (!exists) await fs.mkdir(path.dirname(plan), { recursive: true })
      const part = await sessionUpdatePart({
        id: Identifier.ascending("part"),
        messageID: userMessage.info.id,
        sessionID: userMessage.info.sessionID,
        type: "text",
        text: `<system-reminder>
Plan mode is active. The user indicated that they do not want you to execute yet -- you MUST NOT make any edits (with the exception of the plan file mentioned below), run any non-readonly tools (including changing configs or making commits), or otherwise make any changes to the system. This supercedes any other instructions you have received.

## Plan File Info:
${exists ? `A plan file already exists at ${plan}. You can read it and make incremental edits using the edit tool.` : `No plan file exists yet. You should create your plan at ${plan} using the write tool.`}
You should build your plan incrementally by writing to or editing this file. NOTE that this is the only file you are allowed to edit - other than this you are only allowed to take READ-ONLY actions.

## Plan Workflow

### Phase 1: Initial Understanding
Goal: Gain a comprehensive understanding of the user's request by reading through code and asking them questions. Critical: In this phase you should only use the explore subagent type.

1. Focus on understanding the user's request and the code associated with their request

2. **Launch up to 3 explore agents IN PARALLEL** (single message, multiple tool calls) to efficiently explore the codebase.
   - Use 1 agent when the task is isolated to known files, the user provided specific file paths, or you're making a small targeted change.
   - Use multiple agents when: the scope is uncertain, multiple areas of the codebase are involved, or you need to understand existing patterns before planning.
   - Quality over quantity - 3 agents maximum, but you should try to use the minimum number of agents necessary (usually just 1)
   - If using multiple agents: Provide each agent with a specific search focus or area to explore. Example: One agent searches for existing implementations, another explores related components, a third investigates testing patterns

3. After exploring the code, use the question tool to clarify ambiguities in the user request up front.

### Phase 2: Design
Goal: Design an implementation approach.

Launch general agent(s) to design the implementation based on the user's intent and your exploration results from Phase 1.

You can launch up to 1 agent(s) in parallel.

**Guidelines:**
- **Default**: Launch at least 1 Plan agent for most tasks - it helps validate your understanding and consider alternatives
- **Skip agents**: Only for truly trivial tasks (typo fixes, single-line changes, simple renames)

Examples of when to use multiple agents:
- The task touches multiple parts of the codebase
- It's a large refactor or architectural change
- There are many edge cases to consider
- You'd benefit from exploring different approaches

Example perspectives by task type:
- New feature: simplicity vs performance vs maintainability
- Bug fix: root cause vs workaround vs prevention
- Refactoring: minimal change vs clean architecture

In the agent prompt:
- Provide comprehensive background context from Phase 1 exploration including filenames and code path traces
- Describe requirements and constraints
- Request a detailed implementation plan

### Phase 3: Review
Goal: Review the plan(s) from Phase 2 and ensure alignment with the user's intentions.
1. Read the critical files identified by agents to deepen your understanding
2. Ensure that the plans align with the user's original request
3. Use question tool to clarify any remaining questions with the user

### Phase 4: Final Plan
Goal: Write your final plan to the plan file (the only file you can edit).
- Include only your recommended approach, not all alternatives
- Ensure that the plan file is concise enough to scan quickly, but detailed enough to execute effectively
- Include the paths of critical files to be modified
- Include a verification section describing how to test the changes end-to-end (run the code, use MCP tools, run tests)

### Phase 5: Call plan_exit tool
At the very end of your turn, once you have asked the user questions and are happy with your final plan file - you should always call plan_exit to indicate to the user that you are done planning.
This is critical - your turn should only end with either asking the user a question or calling plan_exit. Do not stop unless it's for these 2 reasons.

**Important:** Use question tool to clarify requirements/approach, use plan_exit to request plan approval. Do NOT use question tool to ask "Is this plan okay?" - that's what plan_exit does.

NOTE: At any point in time through this workflow you should feel free to ask the user questions or clarifications. Don't make large assumptions about user intent. The goal is to present a well researched plan to the user, and tie any loose ends before implementation begins.
</system-reminder>`,
        synthetic: true,
      })
      userMessage.parts.push(part)
      return input.messages
    }
    return input.messages
  }

  export const ShellInput = z.object({
    sessionID: Identifier.schema("session"),
    agent: z.string(),
    model: z
      .object({
        providerID: z.string(),
        modelID: z.string(),
      })
      .optional(),
    command: z.string(),
  })
  export type ShellInput = z.infer<typeof ShellInput>
  async function shell(input: ShellInput) {
    const controller = start(input.sessionID)
    if (!controller) {
      throw new Session.BusyError(input.sessionID)
    }
    const abort = controller.signal
    await using _ = defer(() => finish(input.sessionID, controller))
    const ctx = await currentContext()

    const session = await sessionGet(input.sessionID)
    if (session.revert) {
      void runRevert(
        Effect.gen(function* () {
          const revert = yield* SessionRevert.Service
          yield* revert.cleanup(session)
        }),
      )
    }
    const agent = await agentRequired(input.agent)
    const model = input.model ?? agent.model ?? (await lastModel(input.sessionID))
    const userMsg: MessageV2.User = {
      id: Identifier.ascending("message"),
      sessionID: input.sessionID,
      time: {
        created: Date.now(),
      },
      role: "user",
      agent: input.agent,
      model: {
        providerID: model.providerID,
        modelID: model.modelID,
      },
    }
    await sessionUpdateMessage(userMsg)
    const userPart: MessageV2.Part = {
      type: "text",
      id: Identifier.ascending("part"),
      messageID: userMsg.id,
      sessionID: input.sessionID,
      text: "The following tool was executed by the user",
      synthetic: true,
    }
    await sessionUpdatePart(userPart)

    const msg: MessageV2.Assistant = {
      id: Identifier.ascending("message"),
      sessionID: input.sessionID,
      parentID: userMsg.id,
      mode: input.agent,
      agent: input.agent,
      cost: 0,
      path: {
        cwd: ctx.directory,
        root: ctx.worktree,
      },
      time: {
        created: Date.now(),
      },
      role: "assistant",
      tokens: {
        input: 0,
        output: 0,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      },
      modelID: model.modelID,
      providerID: model.providerID,
    }
    await sessionUpdateMessage(msg)
    const part: MessageV2.Part = {
      type: "tool",
      id: Identifier.ascending("part"),
      messageID: msg.id,
      sessionID: input.sessionID,
      tool: "bash",
      callID: ulid(),
      state: {
        status: "running",
        time: {
          start: Date.now(),
        },
        input: {
          command: input.command,
        },
      },
    }
    await sessionUpdatePart(part)
    const shell = Shell.preferred()
    const shellName = (
      process.platform === "win32" ? path.win32.basename(shell, ".exe") : path.basename(shell)
    ).toLowerCase()

    const invocations: Record<string, { args: string[] }> = {
      nu: {
        args: ["-c", input.command],
      },
      fish: {
        args: ["-c", input.command],
      },
      zsh: {
        args: [
          "-c",
          "-l",
          `
            [[ -f ~/.zshenv ]] && source ~/.zshenv >/dev/null 2>&1 || true
            [[ -f "\${ZDOTDIR:-$HOME}/.zshrc" ]] && source "\${ZDOTDIR:-$HOME}/.zshrc" >/dev/null 2>&1 || true
            eval ${JSON.stringify(input.command)}
          `,
        ],
      },
      bash: {
        args: [
          "-c",
          "-l",
          `
            shopt -s expand_aliases
            [[ -f ~/.bashrc ]] && source ~/.bashrc >/dev/null 2>&1 || true
            eval ${JSON.stringify(input.command)}
          `,
        ],
      },
      cmd: {
        args: ["/c", input.command],
      },
      powershell: {
        args: ["-NoProfile", "-Command", input.command],
      },
      pwsh: {
        args: ["-NoProfile", "-Command", input.command],
      },
      "": {
        args: ["-c", `${input.command}`],
      },
    }

    const matchingInvocation = invocations[shellName] ?? invocations[""]
    const args = matchingInvocation?.args

    const proc = spawn(shell, args, {
      cwd: ctx.directory,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        TERM: "dumb",
      },
    })

    let output = ""

    proc.stdout?.on("data", (chunk) => {
      output += chunk.toString()
      if (part.state.status === "running") {
        part.state.metadata = {
          output: output,
          description: "",
        }
        void sessionUpdatePart(part)
      }
    })

    proc.stderr?.on("data", (chunk) => {
      output += chunk.toString()
      if (part.state.status === "running") {
        part.state.metadata = {
          output: output,
          description: "",
        }
        void sessionUpdatePart(part)
      }
    })

    let aborted = false
    let exited = false

    const kill = () => Shell.killTree(proc, { exited: () => exited })

    if (abort.aborted) {
      aborted = true
      await kill()
    }

    const abortHandler = () => {
      aborted = true
      void kill()
    }

    abort.addEventListener("abort", abortHandler, { once: true })

    await new Promise<void>((resolve) => {
      proc.on("close", () => {
        exited = true
        abort.removeEventListener("abort", abortHandler)
        resolve()
      })
    })

    if (aborted) {
      output += "\n\n" + ["<metadata>", "User aborted the command", "</metadata>"].join("\n")
    }
    msg.time.completed = Date.now()
    await sessionUpdateMessage(msg)
    if (part.state.status === "running") {
      part.state = {
        status: "completed",
        time: {
          ...part.state.time,
          end: Date.now(),
        },
        input: part.state.input,
        title: "",
        metadata: {
          output,
          description: "",
        },
        output,
      }
      await sessionUpdatePart(part)
    }
    return { info: msg, parts: [part] }
  }

  export const CommandInput = z.object({
    messageID: Identifier.schema("message").optional(),
    sessionID: Identifier.schema("session"),
    agent: z.string().optional(),
    model: z.string().optional(),
    arguments: z.string(),
    command: z.string(),
    variant: z.string().optional(),
    parts: z
      .array(
        z.discriminatedUnion("type", [
          MessageV2.FilePart.omit({
            messageID: true,
            sessionID: true,
          }).partial({
            id: true,
          }),
        ]),
      )
      .optional(),
  })
  export type CommandInput = z.infer<typeof CommandInput>
  const bashRegex = /!`([^`]+)`/g
  const argsRegex = /(?:\[Image\s+\d+\]|"[^"]*"|'[^']*'|[^\s"']+)/gi
  const placeholderRegex = /\$(\d+)/g
  const quoteTrimRegex = /^["']|["']$/g

  async function command(input: CommandInput) {
    log.info("command", input)
    const command = await commandGet(input.command)
    if (!command) throw new Error(`Command "${input.command}" not found`)
    const agentName = command.agent ?? input.agent ?? (await defaultAgent())

    const raw = input.arguments.match(argsRegex) ?? []
    const args = raw.map((arg) => arg.replace(quoteTrimRegex, ""))

    const templateCommand = await command.template

    const placeholders = templateCommand.match(placeholderRegex) ?? []
    let last = 0
    for (const item of placeholders) {
      const value = Number(item.slice(1))
      if (value > last) last = value
    }

    const withArgs = templateCommand.replaceAll(placeholderRegex, (_, index) => {
      const position = Number(index)
      const argIndex = position - 1
      if (argIndex >= args.length) return ""
      if (position === last) return args.slice(argIndex).join(" ")
      return args[argIndex]
    })
    const usesArgumentsPlaceholder = templateCommand.includes("$ARGUMENTS")
    let template = withArgs.replaceAll("$ARGUMENTS", input.arguments)

    if (placeholders.length === 0 && !usesArgumentsPlaceholder && input.arguments.trim()) {
      template = template + "\n\n" + input.arguments
    }

    const shell = ConfigMarkdown.shell(template)
    if (shell.length > 0) {
      const results = await Promise.all(
        shell.map(async ([, cmd]) => {
          try {
            return await $`${{ raw: cmd }}`.quiet().nothrow().text()
          } catch (error) {
            return `Error executing command: ${error instanceof Error ? error.message : String(error)}`
          }
        }),
      )
      let index = 0
      template = template.replace(bashRegex, () => results[index++])
    }
    template = template.trim()

    const taskModel = await (async () => {
      if (command.model) {
        return Provider.parseModel(command.model)
      }
      if (command.agent) {
        const cmdAgent = await agentGet(command.agent)
        if (cmdAgent?.model) {
          return cmdAgent.model
        }
      }
      if (input.model) return Provider.parseModel(input.model)
      return await lastModel(input.sessionID)
    })()

    try {
      await providerGetModel(taskModel.providerID, taskModel.modelID)
    } catch (e) {
      if (Provider.ModelNotFoundError.isInstance(e)) {
        const { providerID, modelID, suggestions } = e.data
        const hint = suggestions?.length ? ` Did you mean: ${suggestions.join(", ")}?` : ""
        Bus.publish(Session.Event.Error, {
          sessionID: input.sessionID,
          error: new NamedError.Unknown({ message: `Model not found: ${providerID}/${modelID}.${hint}` }).toObject(),
        })
      }
      throw e
    }
    const agent = await agentGet(agentName)
    if (!agent) {
      const available = await agentList().then((agents) => agents.filter((a) => !a.hidden).map((a) => a.name))
      const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
      const error = new NamedError.Unknown({ message: `Agent not found: "${agentName}".${hint}` })
      Bus.publish(Session.Event.Error, {
        sessionID: input.sessionID,
        error: error.toObject(),
      })
      throw error
    }

    const templateParts = await resolvePromptParts(template)
    const isSubtask = (agent.mode === "subagent" && command.subtask !== false) || command.subtask === true
    const parts = isSubtask
      ? [
          {
            type: "subtask" as const,
            agent: agent.name,
            description: command.description ?? "",
            command: input.command,
            model: {
              providerID: taskModel.providerID,
              modelID: taskModel.modelID,
            },
            prompt: templateParts.find((y) => y.type === "text")?.text ?? "",
          },
        ]
      : [...templateParts, ...(input.parts ?? [])]

    const userAgent = isSubtask ? (input.agent ?? (await defaultAgent())) : agentName
    const userModel = isSubtask
      ? input.model
        ? Provider.parseModel(input.model)
        : await lastModel(input.sessionID)
      : taskModel

    await runPlugin(
      Effect.gen(function* () {
        const plugin = yield* Plugin.Service
        yield* plugin.trigger(
          "command.execute.before",
          {
            command: input.command,
            sessionID: input.sessionID,
            arguments: input.arguments,
          },
          { parts },
        )
      }),
    )

    const result = (await prompt({
      sessionID: input.sessionID,
      messageID: input.messageID,
      model: userModel,
      agent: userAgent,
      parts,
      variant: input.variant,
    })) as MessageV2.WithParts

    Bus.publish(Command.Event.Executed, {
      name: input.command,
      sessionID: input.sessionID,
      arguments: input.arguments,
      messageID: result.info.id,
    })

    return result
  }

  async function ensureTitle(input: {
    session: Session.Info
    history: MessageV2.WithParts[]
    providerID: string
    modelID: string
  }) {
    if (input.session.parentID) return
    if (!Session.isDefaultTitle(input.session.title)) return

    const firstRealUserIdx = input.history.findIndex(
      (m) => m.info.role === "user" && !m.parts.every((p) => "synthetic" in p && p.synthetic),
    )
    if (firstRealUserIdx === -1) return

    const isFirst =
      input.history.filter((m) => m.info.role === "user" && !m.parts.every((p) => "synthetic" in p && p.synthetic))
        .length === 1
    if (!isFirst) return

    const contextMessages = input.history.slice(0, firstRealUserIdx + 1)
    const firstRealUser = contextMessages[firstRealUserIdx]

    const subtaskParts = firstRealUser.parts.filter((p) => p.type === "subtask") as MessageV2.SubtaskPart[]
    const hasOnlySubtaskParts = subtaskParts.length > 0 && firstRealUser.parts.every((p) => p.type === "subtask")

    const agent = await agentGet("title")
    if (!agent) return
    const model = await iife(async () => {
      if (agent.model) return await providerGetModel(agent.model.providerID, agent.model.modelID)
      return (
        (await providerGetSmallModel(input.providerID)) ?? (await providerGetModel(input.providerID, input.modelID))
      )
    })
    const result = await LLM.stream({
      agent,
      user: firstRealUser.info as MessageV2.User,
      system: [],
      small: true,
      tools: {},
      model,
      abort: new AbortController().signal,
      sessionID: input.session.id,
      retries: 2,
      messages: [
        {
          role: "user",
          content: "Generate a title for this conversation:\n",
        },
        ...(hasOnlySubtaskParts
          ? [{ role: "user" as const, content: subtaskParts.map((p) => p.prompt).join("\n") }]
          : MessageV2.toModelMessages(contextMessages, model)),
      ],
    })
    const text = await result.text.catch((err) => log.error("failed to generate title", { error: err }))
    if (text)
      return sessionUpdate(
        input.session.id,
        (draft) => {
          const cleaned = text
            .replace(/<think>[\s\S]*?<\/think>\s*/g, "")
            .split("\n")
            .map((line) => line.trim())
            .find((line) => line.length > 0)
          if (!cleaned) return

          const title = cleaned.length > 100 ? cleaned.substring(0, 97) + "..." : cleaned
          draft.title = title
        },
        { touch: false },
      )
  }

  function decodeDataUrlTextPayload(metadata: string, payload: string) {
    if (!metadata.includes(";base64")) {
      try {
        return decodeURIComponent(payload)
      } catch {
        return payload
      }
    }

    const normalized = payload.replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/")
    const unpadded = normalized.replace(/=+$/, "")
    if (!unpadded || unpadded.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) {
      try {
        return decodeURIComponent(payload)
      } catch {
        return payload
      }
    }

    const padded = unpadded.padEnd(Math.ceil(unpadded.length / 4) * 4, "=")
    const bytes = Buffer.from(padded, "base64")
    const roundTrip = bytes.toString("base64").replace(/=+$/, "")
    if (roundTrip !== unpadded) {
      try {
        return decodeURIComponent(payload)
      } catch {
        return payload
      }
    }

    return bytes.toString()
  }

  export const layer = Layer.succeed(
    Service,
    Service.of({
      assertNotBusy: (sessionID) =>
        Effect.gen(function* () {
          const match = (yield* getServiceStateEffect())[sessionID]
          if (match) throw new Session.BusyError(sessionID)
        }),
      prompt: (input) => Effect.tryPromise(() => prompt(input)),
      resolvePromptParts: (template) =>
        InstanceState.context.pipe(
          Effect.flatMap((ctx) => Effect.tryPromise(() => resolvePromptPartsImpl(ctx, template))),
        ),
      cancel: (sessionID) => Effect.sync(() => cancel(sessionID)),
      loop: (sessionID) => Effect.tryPromise(() => loop(sessionID)),
      shell: (input) => Effect.tryPromise(() => shell(input)),
      command: (input) => Effect.tryPromise(() => command(input)),
    }),
  )

  export const defaultLayer = layer
}
