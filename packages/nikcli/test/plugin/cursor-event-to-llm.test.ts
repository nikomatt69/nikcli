import { describe, expect, it } from "bun:test"
import { CursorEventToLLM, type StreamJsonEvent } from "@/plugin/cursor"

describe("CursorEventToLLM", () => {
  it("skips buffered flushes that carry model_call_id", () => {
    const c = new CursorEventToLLM()
    const partial: StreamJsonEvent = {
      type: "assistant",
      timestamp_ms: 1,
      message: { role: "assistant", content: [{ type: "text", text: "Hello" }] },
    }
    const flush: StreamJsonEvent = {
      type: "assistant",
      timestamp_ms: 2,
      model_call_id: "mc_1",
      message: { role: "assistant", content: [{ type: "text", text: "Hello" }] },
    }
    expect(c.handle(partial)).toEqual([{ type: "text-delta", text: "Hello" } as any])
    expect(c.handle(flush)).toEqual([])
  })

  it("emits providerExecuted tool-call and tool-result", () => {
    const c = new CursorEventToLLM()
    const started = c.handle({
      type: "tool_call",
      subtype: "started",
      call_id: "call_1",
      tool_call: { shellToolCall: { args: { command: "ls" } } },
    })
    expect(started).toHaveLength(1)
    expect(started[0]).toMatchObject({
      type: "tool-call",
      id: "call_1",
      name: "bash",
      providerExecuted: true,
    })

    const completed = c.handle({
      type: "tool_call",
      subtype: "completed",
      call_id: "call_1",
      tool_call: {
        shellToolCall: {
          args: { command: "ls" },
          result: { success: { content: "ok" } },
        } as any,
      },
    })
    expect(completed).toHaveLength(1)
    expect(completed[0]).toMatchObject({
      type: "tool-result",
      id: "call_1",
      name: "bash",
      providerExecuted: true,
      result: { type: "text", value: "ok" },
    })
  })

  it("maps tool errors to tool-error", () => {
    const c = new CursorEventToLLM()
    c.handle({
      type: "tool_call",
      subtype: "started",
      call_id: "call_err",
      tool_call: { shellToolCall: { args: { command: "nope" } } },
    })
    const events = c.handle({
      type: "tool_call",
      subtype: "completed",
      call_id: "call_err",
      tool_call: {
        shellToolCall: {
          args: { command: "nope" },
          result: { error: "permission denied" },
        } as any,
      },
    })
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: "tool-error",
      id: "call_err",
      message: "permission denied",
      providerExecuted: true,
    })
  })

  it("does not double-emit text after seeing partials", () => {
    const c = new CursorEventToLLM()
    c.handle({
      type: "assistant",
      timestamp_ms: 1,
      message: { role: "assistant", content: [{ type: "text", text: "Hi" }] },
    })
    const final = c.handle({
      type: "assistant",
      message: { role: "assistant", content: [{ type: "text", text: "Hi there" }] },
    })
    expect(final).toEqual([])
  })
})
