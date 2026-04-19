import { describe, expect, it } from "bun:test"
import { convertToOpenAICompatibleChatMessages } from "../../../src/provider/sdk/copilot/chat/convert-to-openai-compatible-chat-messages"
import { getResponseMetadata } from "../../../src/provider/sdk/copilot/chat/get-response-metadata"
import { mapOpenAICompatibleFinishReason } from "../../../src/provider/sdk/copilot/chat/map-openai-compatible-finish-reason"

describe("copilot SDK smoke", () => {
  it("converts a simple text user message", () => {
    const messages = convertToOpenAICompatibleChatMessages([
      {
        role: "user",
        content: [{ type: "text", text: "hello" }],
      },
    ])

    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({ role: "user", content: "hello" })
  })

  it("propagates reasoning_text from assistant reasoning parts", () => {
    const messages = convertToOpenAICompatibleChatMessages([
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "think step by step" },
          { type: "text", text: "answer" },
        ],
      },
    ])

    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({
      role: "assistant",
      content: "answer",
      reasoning_text: "think step by step",
    })
  })

  it("propagates reasoning_opaque from copilot providerOptions on a tool-call part", () => {
    const messages = convertToOpenAICompatibleChatMessages([
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "call_1",
            toolName: "echo",
            input: { message: "hi" },
            providerOptions: {
              copilot: { reasoningOpaque: "opaque-token" },
            },
          },
        ],
      },
    ])

    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({
      role: "assistant",
      reasoning_opaque: "opaque-token",
    })
  })

  it("getResponseMetadata returns normalized metadata", () => {
    const meta = getResponseMetadata({ id: "resp_1", model: "gpt-4o", created: 1_700_000_000 })
    expect(meta.id).toBe("resp_1")
    expect(meta.modelId).toBe("gpt-4o")
    expect(meta.timestamp).toBeInstanceOf(Date)
  })

  it("mapOpenAICompatibleFinishReason maps known reasons", () => {
    expect(mapOpenAICompatibleFinishReason("tool_calls")).toBe("tool-calls")
    expect(mapOpenAICompatibleFinishReason("stop")).toBe("stop")
    expect(mapOpenAICompatibleFinishReason("length")).toBe("length")
    expect(mapOpenAICompatibleFinishReason("content_filter")).toBe("content-filter")
    expect(mapOpenAICompatibleFinishReason(undefined)).toBe("unknown")
  })
})
