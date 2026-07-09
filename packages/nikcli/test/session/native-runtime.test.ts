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

  it("does not accumulate abort listeners when iter wins the race", async () => {
    // Many iterations with a signal that never fires. Without explicit
    // removeEventListener, abort listener count would grow without bound.
    async function* source(n: number) {
      for (let i = 0; i < n; i++) yield i
    }
    const ac = new AbortController()
    // Spy on addEventListener / removeEventListener to count net listener churn.
    let added = 0
    let removed = 0
    const origAdd = ac.signal.addEventListener.bind(ac.signal)
    const origRemove = ac.signal.removeEventListener.bind(ac.signal)
    ac.signal.addEventListener = ((type: string, listener: any, opts?: any) => {
      if (type === "abort") added++
      return origAdd(type, listener, opts)
    }) as typeof ac.signal.addEventListener
    ac.signal.removeEventListener = ((type: string, listener: any, opts?: any) => {
      if (type === "abort") removed++
      return origRemove(type, listener, opts)
    }) as typeof ac.signal.removeEventListener

    const out: number[] = []
    for await (const v of abortableIterable(source(50), ac.signal)) {
      out.push(v)
    }
    expect(out.length).toBe(50)
    // Every added listener must be removed.
    expect(removed).toBe(added)
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
