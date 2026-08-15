import { describe, expect, test } from "bun:test"
import { Identifier } from "@nikcli-ai/util/id"
import { SessionEntry } from "../../src/session/v2/entry"
import type { MessageV2 } from "../../src/session/message-v2"

function roundtrip(part: MessageV2.Part) {
  const entry = SessionEntry.fromV1Part(part, { sessionID: part.sessionID, messageID: part.messageID })
  expect(entry).toBeDefined()
  const back = SessionEntry.toV1Part(entry!)
  expect(back).toBeDefined()
  expect(SessionEntry.fromV1Part(back!, { sessionID: part.sessionID, messageID: part.messageID })).toEqual(entry)
}

const tokens = { input: 1, output: 2, reasoning: 0, cache: { read: 0, write: 0 } }

function wire<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

describe("SessionEntry.toV1Part", () => {
  test("roundtrips text, reasoning, tool, subtask, retry, compaction, snapshot, patch, and step markers", () => {
    const sessionID = Identifier.ascending("session")
    const messageID = Identifier.ascending("message")

    roundtrip({
      id: Identifier.ascending("part"),
      sessionID,
      messageID,
      type: "text",
      text: "hello",
      synthetic: true,
      metadata: { provider: { openai: { itemId: "x" } } },
      time: { start: 10, end: 20 },
    })

    roundtrip({
      id: Identifier.ascending("part"),
      sessionID,
      messageID,
      type: "reasoning",
      text: "think",
      time: { start: 11, end: 21 },
    })

    roundtrip({
      id: Identifier.ascending("part"),
      sessionID,
      messageID,
      type: "tool",
      callID: "call_1",
      tool: "read",
      state: {
        status: "completed",
        input: { path: "a.ts" },
        output: "ok",
        title: "read",
        metadata: {},
        time: { start: 1, end: 2 },
      },
    } as MessageV2.Part)

    roundtrip({
      id: Identifier.ascending("part"),
      sessionID,
      messageID,
      type: "subtask",
      prompt: "do it",
      description: "desc",
      agent: "build",
    })

    roundtrip({
      id: Identifier.ascending("part"),
      sessionID,
      messageID,
      type: "retry",
      attempt: 1,
      error: { name: "APIError", data: { message: "boom", isRetryable: true } },
      time: { created: 42 },
    } as MessageV2.Part)

    roundtrip({
      id: Identifier.ascending("part"),
      sessionID,
      messageID,
      type: "compaction",
      auto: true,
    })

    roundtrip({
      id: Identifier.ascending("part"),
      sessionID,
      messageID,
      type: "snapshot",
      snapshot: "abc123",
    })

    roundtrip({
      id: Identifier.ascending("part"),
      sessionID,
      messageID,
      type: "patch",
      hash: "def456",
      files: ["a.ts", "b.ts"],
    })

    roundtrip({
      id: Identifier.ascending("part"),
      sessionID,
      messageID,
      type: "step-start",
      snapshot: "snap-1",
    })

    roundtrip({
      id: Identifier.ascending("part"),
      sessionID,
      messageID,
      type: "step-finish",
      reason: "stop",
      snapshot: "snap-2",
      cost: 0.1,
      tokens,
    })
  })

  test("does not convert message-level entries", () => {
    const sessionID = Identifier.ascending("session")
    const messageID = Identifier.ascending("message")
    expect(
      SessionEntry.toV1Part(
        SessionEntry.User.parse({
          id: SessionEntry.idForMessage(messageID, "user"),
          sessionID,
          messageID,
          timestamp: 1,
          type: "user",
          text: "hi",
          files: [],
          agents: [],
        }),
      ),
    ).toBeUndefined()
  })
})

describe("SessionEntry.toV1Message", () => {
  test("roundtrips a user message including envelope fields and folded parts", () => {
    const sessionID = Identifier.ascending("session")
    const messageID = Identifier.ascending("message")
    const info: MessageV2.User = {
      id: messageID,
      sessionID,
      role: "user",
      time: { created: 10 },
      agent: "build",
      model: { providerID: "p", modelID: "m" },
      system: "be brief",
      variant: "max",
      tools: { bash: false },
      format: { type: "text" },
    }
    const text = {
      id: Identifier.ascending("part"),
      sessionID,
      messageID,
      type: "text" as const,
      text: "hello",
    }
    const synthetic = {
      id: Identifier.ascending("part"),
      sessionID,
      messageID,
      type: "text" as const,
      text: "<system-reminder>",
      synthetic: true,
    }
    const file = {
      id: Identifier.ascending("part"),
      sessionID,
      messageID,
      type: "file" as const,
      mime: "text/plain",
      url: "file:///a.txt",
      filename: "a.txt",
    }

    const entry = SessionEntry.fromV1User(info, [text, synthetic, file])
    expect(entry.text).toBe("hello")
    expect(wire(SessionEntry.toV1Message([entry]))).toEqual(wire(info))
    expect(SessionEntry.partsFromUser(entry)).toEqual([text, synthetic, file])
    expect(SessionEntry.toV1WrittenPart(entry, synthetic)).toEqual(synthetic)
  })

  test("roundtrips an assistant message including path, parentID, and in-flight cost", () => {
    const sessionID = Identifier.ascending("session")
    const info: MessageV2.Assistant = {
      id: Identifier.ascending("message"),
      sessionID,
      role: "assistant",
      time: { created: 20 },
      parentID: Identifier.ascending("message"),
      modelID: "m",
      providerID: "p",
      mode: "build",
      agent: "build",
      path: { cwd: "/tmp", root: "/tmp" },
      cost: 1.5,
      tokens,
      finish: "stop",
      structured: { ok: true },
    }

    const framing = SessionEntry.fromV1Assistant(info)
    expect(framing.map((entry) => entry.type)).toEqual(["start"])
    expect(wire(SessionEntry.toV1Message(framing))).toEqual(wire(info))

    const sealed: MessageV2.Assistant = {
      ...info,
      time: { created: 20, completed: 30 },
      summary: true,
    }
    const sealedFraming = SessionEntry.fromV1Assistant(sealed)
    expect(sealedFraming.map((entry) => entry.type)).toEqual(["start", "complete", "compaction"])
    expect(wire(SessionEntry.toV1Message(sealedFraming))).toEqual(wire(sealed))
  })
})
