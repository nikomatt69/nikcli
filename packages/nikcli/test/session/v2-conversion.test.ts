import { describe, expect, it } from "bun:test"
import { Identifier } from "@/id/id"
import type { MessageV2 } from "@/session/message-v2"
import { SessionEntry } from "@/session/v2/entry"
import { SessionV2 } from "@/session/v2"
import { Stepper } from "@/session/v2/stepper"
import { SessionEvent } from "@/session/v2/event"

const sessionID = Identifier.descending("session")

function assistantInfo(overrides: Partial<MessageV2.Assistant> = {}): MessageV2.Assistant {
  return {
    id: Identifier.ascending("message"),
    sessionID,
    role: "assistant",
    time: { created: 1_700_000_000_000 },
    parentID: Identifier.ascending("message"),
    modelID: "test-model",
    providerID: "test-provider",
    mode: "build",
    agent: "build",
    path: { cwd: "/tmp", root: "/tmp" },
    cost: 0,
    tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
    ...overrides,
  } as MessageV2.Assistant
}

function part<T extends Partial<MessageV2.Part>>(messageID: string, input: T) {
  return {
    id: Identifier.ascending("part"),
    sessionID,
    messageID,
    ...input,
  } as unknown as MessageV2.Part
}

describe("SessionV2.toEntries", () => {
  it("converts every tool state losslessly, including errors", () => {
    const info = assistantInfo({ finish: "stop" })
    const entries = SessionV2.toEntries(
      [
        {
          info,
          parts: [
            part(info.id, { type: "text", text: "hello" }),
            part(info.id, { type: "reasoning", text: "thinking" }),
            part(info.id, {
              type: "tool",
              callID: "call-ok",
              tool: "read",
              state: {
                status: "completed",
                input: { filePath: "a.ts" },
                output: "file contents",
                title: "a.ts",
                metadata: {},
                time: { start: 1, end: 2 },
              },
            }),
            part(info.id, {
              type: "tool",
              callID: "call-bad",
              tool: "bash",
              state: {
                status: "error",
                input: { command: "boom" },
                error: "command failed",
                time: { start: 1, end: 2 },
              },
            }),
            part(info.id, {
              type: "tool",
              callID: "call-running",
              tool: "grep",
              state: { status: "running", input: { pattern: "x" }, time: { start: 1 } },
            }),
          ],
        },
      ],
      sessionID,
    )

    expect(entries).toHaveLength(1)
    const entry = entries[0] as SessionEntry.AssistantText
    expect(entry.role).toBe("assistant")
    expect(entry.finish).toBe("stop")
    expect(entry.parts.map((p) => p.type)).toEqual(["text", "reasoning", "tool-result", "tool-result", "tool-call"])

    const failed = entry.parts[3] as SessionEntry.ToolResultPart
    expect(failed.error).toBe(true)
    expect(failed.result).toBe("command failed")
    expect(failed.toolCallId).toBe("call-bad")

    const running = entry.parts[4] as SessionEntry.ToolCallPart
    expect(running.args).toEqual({ pattern: "x" })
  })

  it("converts v1 retry parts into AssistantRetry entries", () => {
    const info = assistantInfo()
    const entries = SessionV2.toEntries(
      [
        {
          info,
          parts: [
            part(info.id, {
              type: "retry",
              attempt: 2,
              error: {
                name: "APIError",
                data: { message: "rate limited", isRetryable: true, statusCode: 429 },
              },
              time: { created: 1_700_000_000_001 },
            }),
            part(info.id, { type: "text", text: "recovered" }),
          ],
        },
      ],
      sessionID,
    )

    expect(entries).toHaveLength(2)
    const retry = entries[0] as SessionEntry.AssistantRetry
    expect(retry.sub).toBe("retry")
    expect(retry.attempt).toBe(2)
    expect(retry.error.data.message).toBe("rate limited")
    expect((entries[1] as SessionEntry.AssistantText).parts[0]).toEqual({ type: "text", text: "recovered" })
  })

  it("keeps terminal message errors instead of dropping the message", () => {
    const info = assistantInfo({
      error: { name: "MessageAbortedError", data: { message: "aborted" } },
    })
    const entries = SessionV2.toEntries([{ info, parts: [] }], sessionID)

    expect(entries).toHaveLength(1)
    const entry = entries[0] as SessionEntry.AssistantText
    expect(entry.parts).toEqual([])
    expect(entry.metadata?.error).toEqual({ name: "MessageAbortedError", data: { message: "aborted" } })
  })

  it("converts user messages with files and agents", () => {
    const messageID = Identifier.ascending("message")
    const entries = SessionV2.toEntries(
      [
        {
          info: {
            id: messageID,
            sessionID,
            role: "user",
            time: { created: 1_700_000_000_000 },
            agent: "build",
            model: { providerID: "p", modelID: "m" },
          } as MessageV2.User,
          parts: [
            part(messageID, { type: "text", text: "do the thing" }),
            part(messageID, { type: "file", mime: "text/plain", url: "file:///a.txt", filename: "a.txt" }),
            part(messageID, { type: "agent", name: "explore" }),
          ],
        },
      ],
      sessionID,
    )

    expect(entries).toHaveLength(1)
    const user = entries[0] as SessionEntry.User
    expect(user.text).toBe("do the thing")
    expect(user.files).toHaveLength(1)
    expect(user.agents).toHaveLength(1)
  })
})

describe("Stepper.stepWith", () => {
  it("builds a coherent assistant step from an entry-grade event flow", () => {
    const messageID = Identifier.ascending("message")
    let state: Stepper.MemoryState = { entries: [], pending: [] }
    const { adapter } = Stepper.memory()

    type WithoutSession<T> = T extends unknown ? Omit<T, "sessionID"> : never
    const apply = (event: WithoutSession<SessionEvent.Draft>) =>
      (state = Stepper.stepWith(
        state,
        adapter,
        sessionID,
        SessionEvent.create({ ...event, sessionID } as SessionEvent.Draft),
      ))

    apply({ type: "prompt", messageID, text: "hi", files: [], agents: [] })
    apply({ type: "step.started", messageID, providerID: "p", modelID: "m", agent: "build" })
    apply({
      type: "part.updated",
      part: part(messageID, { type: "text", text: "answer" }),
    })
    apply({
      type: "part.updated",
      part: part(messageID, {
        type: "tool",
        callID: "c1",
        tool: "read",
        state: {
          status: "completed",
          input: {},
          output: "ok",
          title: "t",
          metadata: {},
          time: { start: 1, end: 2 },
        },
      }),
    })

    expect(state.entries).toHaveLength(1)
    expect(state.pending).toHaveLength(1)
    const open = state.pending[0] as SessionEntry.AssistantText
    expect(open.modelID).toBe("m")
    expect(open.parts.map((p) => p.type)).toEqual(["text", "tool-result"])

    apply({
      type: "step.ended",
      messageID,
      reason: "stop",
      cost: 0,
      tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
    })

    expect(state.pending).toHaveLength(0)
    expect(state.entries).toHaveLength(2)
    expect((state.entries[1] as SessionEntry.AssistantText).parts).toHaveLength(2)
  })
})
