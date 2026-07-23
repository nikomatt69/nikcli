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

  it("surfaces request-finish as a finish-step carrying the raw finish reason", () => {
    const events = mapLLMEvent(adapterState(), {
      type: "request-finish",
      reason: "tool-calls",
      rawReason: "tool_use",
      usage: { inputTokens: 5, outputTokens: 1, totalTokens: 6 },
    } as LLMEvent)

    const finishStep = events.find((e) => e.type === "finish-step") as any
    expect(finishStep).toBeTruthy()
    expect(finishStep.finishReason).toBe("tool-calls")
    expect(finishStep.rawReason).toBe("tool_use")
    expect(finishStep.usage?.inputTokens).toBe(5)
    // The terminal `finish` still closes the stream.
    expect(events.some((e) => e.type === "finish")).toBe(true)
  })

  it("synthesizes start-step from request-start", () => {
    const events = mapLLMEvent(adapterState(), { type: "request-start", id: "r1" } as LLMEvent)
    expect(events.map((e) => e.type)).toEqual(["start", "start-step"])
  })

  it("closes open text/reasoning before request-finish", () => {
    const s = adapterState()
    mapLLMEvent(s, { type: "text-delta", text: "hi" } as LLMEvent)
    mapLLMEvent(s, { type: "reasoning-delta", text: "think" } as LLMEvent)
    const events = mapLLMEvent(s, { type: "request-finish", reason: "stop" } as LLMEvent)
    expect(events.map((e) => e.type)).toEqual(["reasoning-end", "text-end", "finish-step", "finish"])
  })

  it("omits rawReason when the native event has none", () => {
    const events = mapLLMEvent(adapterState(), {
      type: "request-finish",
      reason: "stop",
    } as LLMEvent)
    const finishStep = events.find((e) => e.type === "finish-step") as any
    expect(finishStep).toBeTruthy()
    expect(finishStep.rawReason).toBeUndefined()
  })

  it("coerces provider-executed tool output to the persisted completed shape", () => {
    const s = adapterState()
    // A json result (like Cursor's shell/bash tool) must become a string output
    // with title/metadata present, or persistence rejects the completed part.
    const events = mapLLMEvent(s, {
      type: "tool-result",
      id: "call_1",
      name: "bash",
      result: { type: "json", value: { exitCode: 0, stdout: "ok" } },
      providerExecuted: true,
    } as LLMEvent)
    const result = events.find((e) => e.type === "tool-result") as any
    expect(result).toBeTruthy()
    expect(typeof result.output.output).toBe("string")
    expect(result.output.output).toContain("exitCode")
    expect(typeof result.output.title).toBe("string")
    expect(result.output.metadata).toEqual({})
    expect(result.providerExecuted).toBe(true)
  })

  it("forwards providerExecuted on tool-call", () => {
    const events = mapLLMEvent(adapterState(), {
      type: "tool-call",
      id: "c1",
      name: "bash",
      input: { command: "ls" },
      providerExecuted: true,
    } as LLMEvent)
    const call = events.find((e) => e.type === "tool-call") as any
    expect(call?.providerExecuted).toBe(true)
  })

  it("maps provider-executed error results to tool-error", () => {
    const events = mapLLMEvent(adapterState(), {
      type: "tool-result",
      id: "c1",
      name: "bash",
      result: { type: "error", value: "permission denied" },
      providerExecuted: true,
    } as LLMEvent)
    expect(events.map((e) => e.type)).toEqual(["tool-error"])
    expect(String((events[0] as any).error)).toContain("permission denied")
  })

  it("starts a text part when a native provider sends a bare delta", () => {
    const events = mapLLMEvent(adapterState(), {
      type: "text-delta",
      text: "hello",
    } as LLMEvent)

    expect(events.map((event) => event.type)).toEqual(["text-start", "text-delta"])
    expect((events[0] as any).id).toBeTruthy()
    expect((events[1] as any).id).toBe((events[0] as any).id)
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
