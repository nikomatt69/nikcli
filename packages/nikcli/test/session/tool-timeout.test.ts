import { describe, expect, it } from "bun:test"
import { executeMcpWithTimeout, executeWithTimeout, resolveToolTimeoutCategory } from "@/session/tools"
import type { Tool } from "@/tool/tool"

// SAFETY: the timeout helpers under test read only `ctx.abort`.
const context = (abort: AbortSignal) => ({ abort }) as Tool.Context

describe("tool outer timeout", () => {
  it("returns quickly when the tool finishes in time", async () => {
    const parent = new AbortController()
    const result = await executeWithTimeout("read", async () => "ok", context(parent.signal), 500)
    expect(result).toBe("ok")
  })

  it("rejects and aborts when the tool hangs past the deadline", async () => {
    const parent = new AbortController()
    let sawAbort = false
    const promise = executeWithTimeout(
      "hang",
      (ctx) =>
        new Promise<string>((_resolve) => {
          ctx.abort.addEventListener("abort", () => {
            sawAbort = true
          })
          // never resolves — outer timeout must reject
        }),
      context(parent.signal),
      40,
    )
    await expect(promise).rejects.toThrow(/timed out after 40ms/)
    expect(sawAbort).toBe(true)
  })

  it("disables the outer bound when timeoutMs is undefined", async () => {
    const parent = new AbortController()
    const result = await executeWithTimeout("read", async () => "free", context(parent.signal), undefined)
    expect(result).toBe("free")
  })

  it("categorizes only the registered task tool as a task timeout", () => {
    expect(resolveToolTimeoutCategory("task", "registry")).toBe("task")
    expect(resolveToolTimeoutCategory("read", "registry")).toBe("tool")
    expect(resolveToolTimeoutCategory("task", "mcp")).toBe("tool")
  })

  it("propagates timeout cancellation through the MCP adapter", async () => {
    const parent = new AbortController()
    let aborted = false
    const promise = executeMcpWithTimeout({
      toolID: "mcp_hang",
      execute: async (_args, options) => {
        await new Promise<void>((resolve) => {
          options.abortSignal?.addEventListener("abort", () => {
            aborted = true
            resolve()
          })
        })
        return "late"
      },
      args: {},
      options: { toolCallId: "call_mcp_timeout", messages: [] },
      context: context(parent.signal),
      timeoutMs: 20,
    })

    await expect(promise).rejects.toThrow(/timed out after 20ms/)
    expect(aborted).toBe(true)
  })
})
