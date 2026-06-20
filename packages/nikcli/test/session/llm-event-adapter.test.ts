import { describe, expect, it } from "bun:test"
import type { LLMEvent } from "@nikcli-ai/llm"
import { mapLLMEvent, adapterState, toProcessorStream } from "@/session/llm/llm-event-adapter"

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

  it("throws on provider-error", () => {
    const s = adapterState()
    expect(() =>
      mapLLMEvent(s, {
        type: "provider-error",
        message: "rate limited",
      } as LLMEvent),
    ).toThrow("rate limited")
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
