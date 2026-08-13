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
    const info = assistantInfo({ finish: "stop", time: { created: 1_700_000_000_000, completed: 1_700_000_000_900 } })
    const entries = SessionV2.toEntries(
      [
        {
          info,
          parts: [
            part(info.id, { type: "text", text: "hello" }),
            part(info.id, { type: "reasoning", text: "thinking", time: { start: 1 } }),
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

    // A step is a `start` entry, one entry per part, and a sealing `complete`
    expect(entries.map((e) => e.type)).toEqual(["start", "text", "reasoning", "tool", "tool", "tool", "complete"])

    const start = entries[0] as SessionEntry.Request
    expect(start.modelID).toBe("test-model")
    expect(start.providerID).toBe("test-provider")
    expect(start.agent).toBe("build")

    const failed = entries[4] as SessionEntry.Tool
    expect(failed.callID).toBe("call-bad")
    expect(failed.state.status).toBe("error")
    if (failed.state.status === "error") expect(failed.state.error).toBe("command failed")

    const running = entries[5] as SessionEntry.Tool
    expect(running.state.status).toBe("running")
    expect(running.state.input).toEqual({ pattern: "x" })

    const complete = entries[6] as SessionEntry.Complete
    expect(complete.finish).toBe("stop")
    expect(complete.reason).toBe("completed")
    expect(complete.tokens.input).toBe(1)
  })

  it("converts v1 retry parts into retry entries, in part order", () => {
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

    expect(entries.map((e) => e.type)).toEqual(["start", "retry", "text"])
    const retry = entries[1] as SessionEntry.Retry
    expect(retry.attempt).toBe(2)
    expect(retry.error.data.message).toBe("rate limited")
    const text = entries[2] as SessionEntry.Text
    expect(text.text).toBe("recovered")
    expect(text.ref).toEqual(expect.any(String))
  })

  it("keeps terminal message errors on the complete entry", () => {
    const info = assistantInfo({
      error: { name: "MessageAbortedError", data: { message: "aborted" } },
    })
    const entries = SessionV2.toEntries([{ info, parts: [] }], sessionID)

    expect(entries.map((e) => e.type)).toEqual(["start", "complete"])
    const complete = entries[1] as SessionEntry.Complete
    expect(complete.reason).toBe("error")
    expect(complete.error).toEqual({ name: "MessageAbortedError", data: { message: "aborted" } })
  })

  it("emits a compaction entry for summary messages", () => {
    const info = assistantInfo({
      summary: true,
      time: { created: 1_700_000_000_000, completed: 1_700_000_000_500 },
    })
    const entries = SessionV2.toEntries([{ info, parts: [] }], sessionID)

    expect(entries.map((e) => e.type)).toEqual(["start", "complete", "compaction"])
    expect((entries[2] as SessionEntry.Compaction).auto).toBe(true)
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
    expect(user.type).toBe("user")
    expect(user.text).toBe("do the thing")
    expect(user.files).toHaveLength(1)
    expect(user.agents).toHaveLength(1)
  })

  it("keeps engine-authored text out of the user entry", () => {
    const messageID = Identifier.ascending("message")
    const entries = SessionV2.toEntries(
      [
        {
          info: {
            id: messageID,
            sessionID,
            role: "user",
            time: { created: 1_700_000_000_000 },
            agent: "plan",
            model: { providerID: "p", modelID: "m" },
          } as MessageV2.User,
          parts: [
            part(messageID, { type: "text", text: "hi" }),
            part(messageID, {
              type: "text",
              text: "<system-reminder>\nPlan mode is active.\n</system-reminder>",
              synthetic: true,
            }),
            part(messageID, { type: "text", text: "stale", ignored: true }),
          ],
        },
      ],
      sessionID,
    )

    expect(entries).toHaveLength(1)
    expect((entries[0] as SessionEntry.User).text).toBe("hi")
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

    expect(state.entries.map((e) => e.type)).toEqual(["user"])
    expect(state.pending.map((e) => e.type)).toEqual(["start", "text", "tool"])
    expect((state.pending[0] as SessionEntry.Request).modelID).toBe("m")

    apply({
      type: "step.ended",
      messageID,
      reason: "stop",
      cost: 0,
      tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
    })

    expect(state.pending).toHaveLength(0)
    expect(state.entries.map((e) => e.type)).toEqual(["user", "start", "text", "tool", "complete"])
  })

  it("upserts a streaming part in place instead of appending duplicates", () => {
    const messageID = Identifier.ascending("message")
    const textPart = part(messageID, { type: "text", text: "" })
    let state: Stepper.MemoryState = { entries: [], pending: [] }
    const { adapter } = Stepper.memory()

    const apply = (draft: SessionEvent.Draft) =>
      (state = Stepper.stepWith(state, adapter, sessionID, SessionEvent.create(draft)))

    apply({ type: "step.started", sessionID, messageID, providerID: "p", modelID: "m", agent: "build" })
    for (const text of ["a", "ab", "abc"]) {
      apply({ type: "part.updated", sessionID, part: { ...textPart, text } as MessageV2.Part })
    }

    expect(state.pending.map((e) => e.type)).toEqual(["start", "text"])
    expect((state.pending[1] as SessionEntry.Text).text).toBe("abc")
  })

  it("collapses a tool's state transitions onto one entry", () => {
    const messageID = Identifier.ascending("message")
    const toolPart = part(messageID, { type: "tool", callID: "c1", tool: "read" })
    let state: Stepper.MemoryState = { entries: [], pending: [] }
    const { adapter } = Stepper.memory()

    const apply = (draft: SessionEvent.Draft) =>
      (state = Stepper.stepWith(state, adapter, sessionID, SessionEvent.create(draft)))

    apply({ type: "step.started", sessionID, messageID, providerID: "p", modelID: "m", agent: "build" })
    apply({
      type: "part.updated",
      sessionID,
      part: { ...toolPart, state: { status: "pending", input: {}, raw: "" } } as MessageV2.Part,
    })
    apply({
      type: "part.updated",
      sessionID,
      part: {
        ...toolPart,
        state: { status: "running", input: { filePath: "a.ts" }, time: { start: 1 } },
      } as MessageV2.Part,
    })
    apply({
      type: "part.updated",
      sessionID,
      part: {
        ...toolPart,
        state: {
          status: "completed",
          input: { filePath: "a.ts" },
          output: "ok",
          title: "a.ts",
          metadata: {},
          time: { start: 1, end: 2 },
        },
      } as MessageV2.Part,
    })

    expect(state.pending.map((e) => e.type)).toEqual(["start", "tool"])
    const tool = state.pending[1] as SessionEntry.Tool
    expect(tool.state.status).toBe("completed")
    expect(tool.callID).toBe("c1")
  })

  it("drops a removed part from the open step", () => {
    const messageID = Identifier.ascending("message")
    const textPart = part(messageID, { type: "text", text: "gone" })
    let state: Stepper.MemoryState = { entries: [], pending: [] }
    const { adapter } = Stepper.memory()

    const apply = (draft: SessionEvent.Draft) =>
      (state = Stepper.stepWith(state, adapter, sessionID, SessionEvent.create(draft)))

    apply({ type: "step.started", sessionID, messageID, providerID: "p", modelID: "m", agent: "build" })
    apply({ type: "part.updated", sessionID, part: textPart })
    expect(state.pending.map((e) => e.type)).toEqual(["start", "text"])

    apply({ type: "part.removed", sessionID, messageID, partID: textPart.id })
    expect(state.pending.map((e) => e.type)).toEqual(["start"])
  })
})
