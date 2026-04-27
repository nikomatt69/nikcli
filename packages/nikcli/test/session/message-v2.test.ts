import { describe, expect, it } from "bun:test"
import { Identifier } from "@/id/id"
import { MessageV2 } from "@/session/message-v2"

describe("MessageV2 schemas and helpers", () => {
  it("parses OutputFormat text", () => {
    const parsed = MessageV2.Format.parse({ type: "text" })
    expect(parsed.type).toBe("text")
  })

  it("parses OutputFormat json_schema with defaults", () => {
    const parsed = MessageV2.Format.parse({
      type: "json_schema",
      schema: { type: "object" },
    })
    expect(parsed.type).toBe("json_schema")
    if (parsed.type === "json_schema") {
      expect(parsed.retryCount).toBe(2)
    }
  })

  it("parses TextPart", () => {
    const part = MessageV2.TextPart.parse({
      id: Identifier.ascending("part"),
      sessionID: Identifier.descending("session"),
      messageID: Identifier.ascending("message"),
      type: "text",
      text: "hello",
    })
    expect(part.text).toBe("hello")
  })

  it("parses User message info", () => {
    const info = MessageV2.User.parse({
      id: Identifier.ascending("message"),
      role: "user",
      sessionID: Identifier.descending("session"),
      time: { created: 1 },
      agent: "build",
      model: { providerID: "p", modelID: "m" },
    })
    expect(info.role).toBe("user")
  })

  it("fromError maps AbortError to aborted shape", () => {
    const err = new DOMException("x", "AbortError")
    const out = MessageV2.fromError(err, { providerID: "openai" })
    expect(out.name).toBe("MessageAbortedError")
  })

  it("toModelMessages maps a minimal user thread for OpenAI-compatible model", () => {
    const sessionID = Identifier.descending("session")
    const messageID = Identifier.ascending("message")
    const user: MessageV2.WithParts = {
      info: {
        id: messageID,
        role: "user",
        sessionID,
        time: { created: 1 },
        agent: "a",
        model: { providerID: "openai", modelID: "gpt-4o-mini" },
      },
      parts: [
        {
          id: Identifier.ascending("part"),
          sessionID,
          messageID,
          type: "text",
          text: "ping",
        },
      ],
    }
    const model = {
      api: { npm: "@ai-sdk/openai", id: "gpt-4o-mini" },
      id: "gpt-4o-mini",
      cost: { input: 1, output: 1, cache: { read: 0, write: 0 } },
    } as Parameters<typeof MessageV2.toModelMessages>[1]

    const out = MessageV2.toModelMessages([user], model)
    expect(out.length).toBeGreaterThanOrEqual(1)
    expect(out[0]?.role).toBe("user")
  })

  it("exposes bus-backed part events", () => {
    expect(MessageV2.Event.PartUpdated.type).toBe("message.part.updated")
    expect(MessageV2.Event.PartRemoved.type).toBe("message.part.removed")
  })
})
