import { describe, expect, it } from "bun:test"
import { abortableIterable, status } from "@/session/llm/native-runtime"

describe("LLMNativeRuntime.abortableIterable", () => {
  it("yields all values when not aborted", async () => {
    async function* source() {
      yield 1
      yield 2
      yield 3
    }
    const ac = new AbortController()
    const out: number[] = []
    for await (const v of abortableIterable(source(), ac.signal)) {
      out.push(v)
    }
    expect(out).toEqual([1, 2, 3])
  })

  it("throws AbortError when already aborted", async () => {
    async function* source() {
      yield 1
    }
    const ac = new AbortController()
    ac.abort()
    await expect(async () => {
      for await (const _ of abortableIterable(source(), ac.signal)) {
        // empty
      }
    }).toThrow(DOMException)
    try {
      for await (const _ of abortableIterable(source(), ac.signal)) {
        // empty
      }
    } catch (e) {
      expect(e).toBeInstanceOf(DOMException)
      expect((e as DOMException).name).toBe("AbortError")
    }
  })

  it("throws AbortError mid-stream when abort fires", async () => {
    async function* source() {
      yield "a"
      await new Promise((r) => setTimeout(r, 50))
      yield "b"
      await new Promise((r) => setTimeout(r, 200))
      yield "c"
    }
    const ac = new AbortController()
    const out: string[] = []
    const iter = abortableIterable(source(), ac.signal)
    const first = await iter.next()
    expect(first.value).toBe("a")
    out.push(first.value as string)

    // Abort while waiting for next item
    setTimeout(() => ac.abort(), 10)
    await expect(iter.next()).rejects.toMatchObject({ name: "AbortError" })
  })
})

describe("LLMNativeRuntime.status OAuth", () => {
  it("returns unsupported for oauth (ADR: AI SDK path)", () => {
    const result = status({
      model: { id: "gpt-4o" } as any,
      provider: {
        id: "openai",
        key: undefined,
        options: { fetch: async () => new Response() },
      } as any,
      auth: { type: "oauth" } as any,
      modelRef: { providerID: "openai", modelID: "gpt-4o" } as any,
    })
    expect(result.type).toBe("unsupported")
    if (result.type === "unsupported") {
      expect(result.reason).toContain("AI SDK")
    }
  })
})
