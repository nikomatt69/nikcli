import { describe, expect, it } from "bun:test"
import { JSONParseError } from "ai"
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
    const out = MessageV2.fromError(err, { providerID: "minimax-coding-plan" })
    expect(out.name).toBe("MessageAbortedError")
  })

  it("fromError maps JSONParseError to retryable APIError (opencode #38041)", () => {
    const longMessage = "x".repeat(500)
    const err = new JSONParseError({
      text: "bad-stream",
      cause: new SyntaxError(longMessage),
    })
    const out = MessageV2.fromError(err, {
      providerID: "minimax-coding-plan",
    }) as {
      name: string
      data: { message: string; isRetryable: boolean }
    }
    expect(out.name).toBe("APIError")
    expect(out.data.isRetryable).toBe(true)
    // message must be truncated to 200 chars (the wrapper prefix + truncated cause)
    expect(out.data.message.startsWith("Provider returned malformed JSON stream:")).toBe(true)
    expect(out.data.message.length).toBeLessThanOrEqual("Provider returned malformed JSON stream: ".length + 200)
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
        model: { providerID: "minimax-coding-plan", modelID: "MiniMax-M2.7" },
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
      api: { npm: "@ai-sdk/anthropic", id: "minimax-coding-plan" },
      id: "MiniMax-M2.7",
      cost: { input: 1, output: 1, cache: { read: 0, write: 0 } },
    } as Parameters<typeof MessageV2.toModelMessages>[1]

    const out = MessageV2.toModelMessages([user], model)
    expect(out.length).toBeGreaterThanOrEqual(1)
    expect(out[0]?.role).toBe("user")
  })

  it("toModelMessages wraps queued user text only when remindAfter is set (cache-stable)", () => {
    const sessionID = Identifier.descending("session")
    const finishedID = Identifier.ascending("message")
    const queuedID = Identifier.ascending("message")
    const user: MessageV2.WithParts = {
      info: {
        id: queuedID,
        role: "user",
        sessionID,
        time: { created: 2 },
        agent: "a",
        model: { providerID: "minimax-coding-plan", modelID: "MiniMax-M2.7" },
      },
      parts: [
        {
          id: Identifier.ascending("part"),
          sessionID,
          messageID: queuedID,
          type: "text",
          text: "please continue",
        },
        {
          id: Identifier.ascending("part"),
          sessionID,
          messageID: queuedID,
          type: "text",
          text: "synthetic note",
          synthetic: true,
        },
      ],
    }
    const model = {
      api: { npm: "@ai-sdk/anthropic", id: "minimax-coding-plan" },
      id: "MiniMax-M2.7",
      cost: { input: 1, output: 1, cache: { read: 0, write: 0 } },
    } as Parameters<typeof MessageV2.toModelMessages>[1]

    const plain = MessageV2.toModelMessages([user], model)
    const plainText = JSON.stringify(plain)
    expect(plainText).toContain("please continue")
    expect(plainText).not.toContain("<system-reminder>")

    const reminded = MessageV2.toModelMessages([user], model, {
      remindAfter: finishedID,
    })
    const remindedText = JSON.stringify(reminded)
    expect(remindedText).toContain("<system-reminder>")
    expect(remindedText).toContain("please continue")
    // Synthetic parts must not be wrapped — appear as plain text content
    expect(remindedText).toContain('"text":"synthetic note"')
    expect(remindedText).not.toContain("synthetic note\\n\\nPlease address")

    // Stored part text is never mutated
    expect(user.parts[0]?.type === "text" && user.parts[0].text).toBe("please continue")
  })

  it("toModelMessages forwards reasoning parts as content (opencode PR #25303)", () => {
    // Regression for cross-model reasoning forwarding: when the destination model
    // differs from the source, anthropic-shaped reasoning parts are collapsed to
    // plain text content to avoid AI_InvalidPromptError on providers that can't
    // validate a foreign signature.
    //
    // We assert on the *content* shape returned by convertToModelMessages, since
    // the ai SDK converts UIMessage parts into ModelMessage content blocks.
    const sessionID = Identifier.descending("session")
    const messageID = Identifier.ascending("message")
    const reasoningText = "I am thinking about this carefully"
    const assistant: MessageV2.WithParts = {
      info: {
        id: messageID,
        sessionID,
        role: "assistant",
        time: { created: 1 },
        parentID: messageID,
        // Source provider/model differs from the destination model below so
        // `differentModel` is true inside toModelMessages.
        providerID: "anthropic",
        modelID: "claude-opus-4.1",
        mode: "build",
        agent: "build",
        path: { cwd: "/repo", root: "/repo" },
        cost: 0,
        tokens: {
          input: 0,
          output: 0,
          reasoning: 0,
          cache: { read: 0, write: 0 },
        },
      },
      parts: [
        {
          id: Identifier.ascending("part"),
          sessionID,
          messageID,
          type: "reasoning",
          text: reasoningText,
          metadata: { signature: "anthropic-only-sig" },
          time: { start: 1, end: 2 },
        },
      ],
    }
    const model = {
      api: { npm: "@ai-sdk/openai", id: "openai" },
      id: "gpt-5",
      cost: { input: 1, output: 1, cache: { read: 0, write: 0 } },
    } as Parameters<typeof MessageV2.toModelMessages>[1]

    const out = MessageV2.toModelMessages([assistant], model)
    expect(out.length).toBe(1)
    const content = (out[0] as { content: unknown }).content
    // The ai SDK normalizes reasoning to text content blocks at conversion time;
    // the key behavior we want to lock in is that the foreign reasoning signature
    // is NOT carried over as a providerMetadata that the receiving model would
    // later reject.
    const serialized = JSON.stringify(content)
    expect(serialized).toContain(reasoningText)
    expect(serialized).not.toContain("anthropic-only-sig")
  })

  it("toModelMessages drops empty cross-model reasoning entirely (opencode PR #25303)", () => {
    // A reasoning part with whitespace-only text should not produce any content
    // on cross-model forwarding — emitting a blank text part would still bloat
    // the request and confuse the destination model.
    const sessionID = Identifier.descending("session")
    const messageID = Identifier.ascending("message")
    const assistant: MessageV2.WithParts = {
      info: {
        id: messageID,
        sessionID,
        role: "assistant",
        time: { created: 1 },
        parentID: messageID,
        providerID: "anthropic",
        modelID: "claude-opus-4.1",
        mode: "build",
        agent: "build",
        path: { cwd: "/repo", root: "/repo" },
        cost: 0,
        tokens: {
          input: 0,
          output: 0,
          reasoning: 0,
          cache: { read: 0, write: 0 },
        },
      },
      parts: [
        {
          id: Identifier.ascending("part"),
          sessionID,
          messageID,
          type: "reasoning",
          text: "   \n  ",
          metadata: { signature: "anthropic-only-sig" },
          time: { start: 1, end: 2 },
        },
      ],
    }
    const model = {
      api: { npm: "@ai-sdk/openai", id: "openai" },
      id: "gpt-5",
      cost: { input: 1, output: 1, cache: { read: 0, write: 0 } },
    } as Parameters<typeof MessageV2.toModelMessages>[1]

    const out = MessageV2.toModelMessages([assistant], model)
    expect(out.length).toBe(0)
  })

  it("toModelMessages preserves reasoning text when the destination model matches the source (opencode PR #25303)", () => {
    // When source and destination match, reasoning is passed through (collapsed
    // to text by convertToModelMessages, but with no foreign-signature risk).
    const sessionID = Identifier.descending("session")
    const messageID = Identifier.ascending("message")
    const reasoningText = "let me think... 2 + 2 = 4"
    const assistant: MessageV2.WithParts = {
      info: {
        id: messageID,
        sessionID,
        role: "assistant",
        time: { created: 1 },
        parentID: messageID,
        providerID: "anthropic",
        modelID: "claude-opus-4.1",
        mode: "build",
        agent: "build",
        path: { cwd: "/repo", root: "/repo" },
        cost: 0,
        tokens: {
          input: 0,
          output: 0,
          reasoning: 0,
          cache: { read: 0, write: 0 },
        },
      },
      parts: [
        {
          id: Identifier.ascending("part"),
          sessionID,
          messageID,
          type: "reasoning",
          text: reasoningText,
          metadata: { signature: "sig-abc" },
          time: { start: 1, end: 2 },
        },
      ],
    }
    const model = {
      api: { npm: "@ai-sdk/anthropic", id: "anthropic" },
      id: "claude-opus-4.1",
      cost: { input: 1, output: 1, cache: { read: 0, write: 0 } },
    } as Parameters<typeof MessageV2.toModelMessages>[1]

    const out = MessageV2.toModelMessages([assistant], model)
    expect(out.length).toBe(1)
    const serialized = JSON.stringify(out[0])
    expect(serialized).toContain(reasoningText)
  })

  it("exposes bus-backed part events", () => {
    expect(MessageV2.Event.PartUpdated.type).toBe("message.part.updated")
    expect(MessageV2.Event.PartRemoved.type).toBe("message.part.removed")
  })
})
