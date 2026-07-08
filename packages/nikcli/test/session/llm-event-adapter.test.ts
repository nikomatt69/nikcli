import { describe, expect, it } from "bun:test"
import { APICallError } from "@ai-sdk/provider"
import type { LLMEvent } from "@nikcli-ai/llm"
import {
  mapLLMEvent,
  adapterState,
  toProcessorStream,
  providerErrorToAPICallError,
} from "@/session/llm/llm-event-adapter"
import { MessageV2 } from "@/session/message-v2"
import { SessionRetry } from "@/session/retry"

describe("llm-event-adapter", () => {
  it("maps text and step-finish with usage", () => {
    const s = adapterState()
    const events = [
      ...mapLLMEvent(s, { type: "step-start", index: 0 } as LLMEvent),
      ...mapLLMEvent(s, {
        type: "text-delta",
        id: "t1",
        text: "hi",
      } as LLMEvent),
      ...mapLLMEvent(s, {
        type: "step-finish",
        index: 0,
        reason: "stop",
        usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
      } as LLMEvent),
    ]
    expect(events.some((e) => e.type === "start-step")).toBe(true)
    expect(events.some((e) => e.type === "finish-step" && (e as any).usage?.inputTokens === 1)).toBe(true)
    expect(events.some((e) => e.type === "text-delta" && (e as any).text === "hi")).toBe(true)
  })

  it("maps tool-call to tool-input-start and tool-call", () => {
    const s = adapterState()
    const events = mapLLMEvent(s, {
      type: "tool-call",
      id: "call-1",
      name: "read",
      input: { path: "/tmp" },
    } as LLMEvent)
    expect(events.map((e) => e.type)).toEqual(["tool-input-start", "tool-input-end", "tool-call"])
    expect((events[2] as any).toolCallId).toBe("call-1")
  })

  it("maps tool-result to AI SDK output shape", () => {
    const s = adapterState()
    const events = mapLLMEvent(s, {
      type: "tool-result",
      id: "call-1",
      name: "read",
      result: { type: "text", value: "file contents" },
    } as LLMEvent)
    expect(events[0]?.type).toBe("tool-result")
    expect((events[0] as any).output?.output).toBe("file contents")
  })

  it("throws APICallError on provider-error (F1.2 retry parity)", () => {
    const s = adapterState()
    expect(() =>
      mapLLMEvent(s, {
        type: "provider-error",
        message: "rate limited",
        retryable: true,
      } as LLMEvent),
    ).toThrow(APICallError)

    try {
      mapLLMEvent(s, {
        type: "provider-error",
        message: "rate limited",
        retryable: true,
      } as LLMEvent)
    } catch (e) {
      expect(APICallError.isInstance(e)).toBe(true)
      expect((e as APICallError).isRetryable).toBe(true)
      expect((e as APICallError).message).toBe("rate limited")
    }
  })

  it("preserves retryable:false on provider-error", () => {
    const err = providerErrorToAPICallError({
      type: "provider-error",
      message: "invalid request",
      retryable: false,
    } as Extract<LLMEvent, { type: "provider-error" }>)
    expect(err.isRetryable).toBe(false)
  })

  it("heuristically marks throttle messages retryable when flag omitted", () => {
    const err = providerErrorToAPICallError({
      type: "provider-error",
      message: "ThrottlingException: Too many requests",
    } as Extract<LLMEvent, { type: "provider-error" }>)
    expect(err.isRetryable).toBe(true)
  })

  it("fromError + SessionRetry see retryable provider-error as APIError", () => {
    const thrown = providerErrorToAPICallError({
      type: "provider-error",
      message: "Bedrock throttle",
      retryable: true,
    } as Extract<LLMEvent, { type: "provider-error" }>)
    const classified = MessageV2.fromError(thrown, {
      providerID: "amazon-bedrock",
    })
    expect(classified.name).toBe("APIError")
    if (classified.name === "APIError") {
      expect(classified.data.isRetryable).toBe(true)
    }
    expect(SessionRetry.retryable(classified)).toBe("Bedrock throttle")
  })

  it("fromError + SessionRetry skip non-retryable provider-error", () => {
    const thrown = providerErrorToAPICallError({
      type: "provider-error",
      message: "model not found",
      retryable: false,
    } as Extract<LLMEvent, { type: "provider-error" }>)
    const classified = MessageV2.fromError(thrown, { providerID: "openai" })
    expect(classified.name).toBe("APIError")
    expect(SessionRetry.retryable(classified)).toBeUndefined()
  })

  it("maps tool-input-delta with delta field", () => {
    const s = adapterState()
    const events = mapLLMEvent(s, {
      type: "tool-input-delta",
      id: "call-1",
      name: "opentui",
      text: '{"x":',
    } as LLMEvent)
    expect((events[0] as any).delta).toBe('{"x":')
  })

  it("streams async iterable", async () => {
    async function* source() {
      yield { type: "request-start", id: "r1", model: {} } as LLMEvent
      yield { type: "text-delta", text: "a" } as LLMEvent
      yield { type: "request-finish", reason: "stop" } as LLMEvent
    }
    const collected: string[] = []
    for await (const e of toProcessorStream(source())) {
      collected.push(e.type)
    }
    expect(collected).toContain("start")
    expect(collected).toContain("text-delta")
    expect(collected).toContain("finish")
  })
})
