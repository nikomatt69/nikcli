import { afterEach, describe, expect, it } from "bun:test"
import {
  EXA_ENDPOINT,
  PARALLEL_ENDPOINT,
  ProviderConfigError,
  format,
  parseExaText,
  parseParallelStructured,
  resolve,
} from "@/tool/websearch/provider"
import { parseResponse } from "@/tool/websearch/mcp"

const originalFetch = globalThis.fetch
const originalExaKey = process.env["EXA_API_KEY"]
const originalParallelKey = process.env["PARALLEL_API_KEY"]

type Captured = { url: string; headers: Record<string, string>; body: any }

/** Stub fetch and capture the outgoing request, replying with an MCP envelope. */
function stubFetch(result: unknown): { captured: Captured[] } {
  const captured: Captured[] = []
  globalThis.fetch = (async (url: any, init: any) => {
    captured.push({
      url: String(url),
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: JSON.parse(init?.body ?? "{}"),
    })
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  }) as typeof fetch
  return { captured }
}

afterEach(() => {
  globalThis.fetch = originalFetch
  if (originalExaKey === undefined) delete process.env["EXA_API_KEY"]
  else process.env["EXA_API_KEY"] = originalExaKey
  if (originalParallelKey === undefined) delete process.env["PARALLEL_API_KEY"]
  else process.env["PARALLEL_API_KEY"] = originalParallelKey
})

describe("websearch provider resolution", () => {
  it("defaults to keyless Exa, preserving the pre-config behaviour", async () => {
    delete process.env["EXA_API_KEY"]
    const { captured } = stubFetch({ content: [{ type: "text", text: "Title: T\nURL: https://e.com\nText:\nbody" }] })

    const provider = resolve({})
    const results = await provider.search({ query: "hello" })

    expect(provider.id).toBe("exa")
    expect(captured[0]!.url).toBe(EXA_ENDPOINT)
    expect(captured[0]!.body.params.name).toBe("web_search_exa")
    expect(results).toEqual([{ url: "https://e.com", title: "T", content: "body" }])
  })

  it("passes an Exa key as a query parameter", async () => {
    const { captured } = stubFetch({ content: [{ type: "text", text: "URL: https://e.com" }] })
    await resolve({ apiKey: "key-123" }).search({ query: "hello" })
    expect(new URL(captured[0]!.url).searchParams.get("exaApiKey")).toBe("key-123")
  })

  it("falls back to EXA_API_KEY from the environment", async () => {
    process.env["EXA_API_KEY"] = "env-key"
    const { captured } = stubFetch({ content: [{ type: "text", text: "URL: https://e.com" }] })
    await resolve({}).search({ query: "hello" })
    expect(new URL(captured[0]!.url).searchParams.get("exaApiKey")).toBe("env-key")
  })

  it("sends the Parallel key as a bearer token", async () => {
    const { captured } = stubFetch({
      content: [{ type: "text", text: "" }],
      structuredContent: { results: [{ url: "https://p.com", title: "P", excerpts: ["one", "two"] }] },
    })

    const provider = resolve({ provider: "parallel", apiKey: "par-1" })
    const results = await provider.search({ query: "hello" })

    expect(provider.id).toBe("parallel")
    expect(captured[0]!.url).toBe(PARALLEL_ENDPOINT)
    expect(captured[0]!.headers["authorization"]).toBe("Bearer par-1")
    expect(captured[0]!.body.params.arguments).toEqual({ objective: "hello", search_queries: ["hello"] })
    expect(results).toEqual([{ url: "https://p.com", title: "P", content: "one\n\ntwo" }])
  })

  it("reports a missing Parallel key as a config error instead of calling out", async () => {
    delete process.env["PARALLEL_API_KEY"]
    let called = false
    globalThis.fetch = (async () => {
      called = true
      return new Response("{}")
    }) as unknown as typeof fetch

    await expect(resolve({ provider: "parallel" }).search({ query: "hello" })).rejects.toBeInstanceOf(
      ProviderConfigError,
    )
    expect(called).toBe(false)
  })

  it("requires a url for the generic mcp provider", async () => {
    await expect(resolve({ provider: "mcp" }).search({ query: "hello" })).rejects.toBeInstanceOf(ProviderConfigError)
  })

  it("queries a user-supplied mcp endpoint", async () => {
    const { captured } = stubFetch({
      structuredContent: { results: [{ url: "https://x.com", excerpts: ["hit"] }] },
    })

    const results = await resolve({ provider: "mcp", url: "https://search.internal/mcp", tool: "find" }).search({
      query: "hello",
    })

    expect(captured[0]!.url).toBe("https://search.internal/mcp")
    expect(captured[0]!.body.params.name).toBe("find")
    expect(results).toEqual([{ url: "https://x.com", content: "hit" }])
  })
})

describe("result parsing", () => {
  it("splits Exa's prose blocks and drops entries with no URL", () => {
    const text = [
      "Title: First\nURL: https://a.com\nPublished: 2026-01-02\nText:\nalpha",
      "Title: Orphan\nPublished: N/A",
      "Title: Second\nURL: https://b.com\nHighlights:\nbeta",
    ].join("\n\n---\n\n")

    expect(parseExaText(text)).toEqual([
      { url: "https://a.com", title: "First", content: "alpha", published: Date.parse("2026-01-02") },
      { url: "https://b.com", title: "Second", content: "beta" },
    ])
  })

  it("ignores an unparseable publication date rather than emitting NaN", () => {
    expect(parseExaText("URL: https://a.com\nPublished: sometime")).toEqual([{ url: "https://a.com" }])
  })

  it("skips structured entries without a url", () => {
    const structured = {
      results: [
        { title: "no url", excerpts: [] },
        { url: "https://ok.com", excerpts: [] },
      ],
    }
    expect(parseParallelStructured(structured)).toEqual([{ url: "https://ok.com" }])
  })

  it("returns nothing for a malformed structured payload", () => {
    expect(parseParallelStructured(undefined)).toEqual([])
    expect(parseParallelStructured({ results: "nope" })).toEqual([])
  })
})

describe("MCP response parsing", () => {
  it("reads a plain JSON body", () => {
    const body = JSON.stringify({ result: { content: [{ type: "text", text: "hi" }] } })
    expect(parseResponse(body).text).toBe("hi")
  })

  it("reads an SSE data frame", () => {
    const body = `event: message\ndata: ${JSON.stringify({ result: { content: [{ type: "text", text: "hi" }] } })}\n\n`
    expect(parseResponse(body).text).toBe("hi")
  })

  it("surfaces a JSON-RPC error", () => {
    const body = JSON.stringify({ error: { code: -32000, message: "rate limited" } })
    expect(() => parseResponse(body, "Exa")).toThrow(/Exa error: -32000 rate limited/)
  })

  it("skips an unparseable frame and uses a later one", () => {
    const body = [
      "data: {not json",
      `data: ${JSON.stringify({ result: { content: [{ type: "text", text: "ok" }] } })}`,
    ].join("\n")
    expect(parseResponse(body).text).toBe("ok")
  })
})

describe("format", () => {
  it("renders title, url, date and content", () => {
    const output = format([
      { url: "https://a.com", title: "First", content: "alpha", published: Date.parse("2026-01-02T00:00:00Z") },
      { url: "https://b.com" },
    ])
    expect(output).toBe("First\nhttps://a.com\nPublished: 2026-01-02\n\nalpha\n\n---\n\nhttps://b.com")
  })
})
