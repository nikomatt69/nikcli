// Web search backends behind one interface.
//
// The tool used to call Exa's hosted MCP endpoint directly, which meant a single
// unauthenticated vendor with no fallback and no way for a user to bring their
// own key. Providers are resolved from config here so the tool itself stays
// unaware of which backend answered.
import type { WebSearchConfig } from "./config"
import { callTool } from "./mcp"

export const EXA_ENDPOINT = "https://mcp.exa.ai/mcp"
export const PARALLEL_ENDPOINT = "https://search.parallel.ai/mcp"

export const DEFAULT_NUM_RESULTS = 8

export interface SearchResult {
  readonly url: string
  readonly title?: string
  readonly content?: string
  /** Epoch millis, when the backend reports a publication date. */
  readonly published?: number
}

export interface SearchInput {
  readonly query: string
  readonly numResults?: number
  /** Backend-specific knobs. Ignored by providers that do not understand them. */
  readonly livecrawl?: "fallback" | "preferred"
  readonly type?: "auto" | "fast" | "deep"
  readonly contextMaxCharacters?: number
  readonly signal?: AbortSignal
}

export interface Provider {
  readonly id: string
  readonly name: string
  readonly search: (input: SearchInput) => Promise<SearchResult[]>
}

export class ProviderConfigError extends Error {}

/**
 * Exa via its hosted MCP endpoint. The key is optional: without one the endpoint
 * still answers on a shared quota, which is what nikcli relied on before this
 * became configurable — so the default path keeps working with no setup.
 */
export function exa(config: WebSearchConfig): Provider {
  const apiKey = config.apiKey ?? process.env["EXA_API_KEY"]
  const url = new URL(config.url ?? EXA_ENDPOINT)
  if (apiKey) url.searchParams.set("exaApiKey", apiKey)

  return {
    id: "exa",
    name: "Exa",
    search: async (input) => {
      const result = await callTool({
        url: url.toString(),
        tool: config.tool ?? "web_search_exa",
        label: "Exa",
        signal: input.signal,
        args: {
          query: input.query,
          numResults: input.numResults ?? DEFAULT_NUM_RESULTS,
          type: input.type ?? "auto",
          livecrawl: input.livecrawl ?? "fallback",
          ...(input.contextMaxCharacters !== undefined
            ? { contextMaxCharacters: input.contextMaxCharacters }
            : {}),
        },
      })
      return result.text ? parseExaText(result.text) : []
    },
  }
}

/** Parallel's search MCP. Requires a key — the endpoint has no anonymous tier. */
export function parallel(config: WebSearchConfig): Provider {
  const apiKey = config.apiKey ?? process.env["PARALLEL_API_KEY"]

  return {
    id: "parallel",
    name: "Parallel",
    search: async (input) => {
      if (!apiKey)
        throw new ProviderConfigError(
          "Parallel web search needs an API key. Set PARALLEL_API_KEY or websearch.apiKey in the nikcli config.",
        )
      const result = await callTool({
        url: config.url ?? PARALLEL_ENDPOINT,
        tool: config.tool ?? "web_search",
        label: "Parallel",
        signal: input.signal,
        headers: { authorization: `Bearer ${apiKey}` },
        args: { objective: input.query, search_queries: [input.query] },
      })
      return parseParallelStructured(result.structured)
    },
  }
}

/**
 * Any MCP server the user points at. The escape hatch that keeps this list from
 * having to grow a case per vendor: results are read from `structuredContent`
 * when present and otherwise passed through as one text block.
 */
export function mcp(config: WebSearchConfig): Provider {
  return {
    id: "mcp",
    name: "MCP",
    search: async (input) => {
      if (!config.url)
        throw new ProviderConfigError('The "mcp" web search provider needs websearch.url set in the nikcli config.')
      const result = await callTool({
        url: config.url,
        tool: config.tool ?? "web_search",
        label: "Web search",
        signal: input.signal,
        headers: config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : undefined,
        args: { query: input.query, numResults: input.numResults ?? DEFAULT_NUM_RESULTS },
      })
      const structured = parseParallelStructured(result.structured)
      if (structured.length > 0) return structured
      return result.text ? parseExaText(result.text) : []
    },
  }
}

export function resolve(config: WebSearchConfig): Provider {
  switch (config.provider ?? "exa") {
    case "parallel":
      return parallel(config)
    case "mcp":
      return mcp(config)
    default:
      return exa(config)
  }
}

/**
 * Exa returns prose, not JSON: `Title:`/`URL:`/`Published:`/`Text:` blocks joined
 * by `---`. Anything without a URL is dropped rather than emitted as a result
 * with no source.
 */
export function parseExaText(text: string): SearchResult[] {
  return text.split(/\n\n---\n\n/).flatMap((block) => {
    const url = block.match(/^URL:\s*(.+)$/m)?.[1]?.trim()
    if (!url) return []
    const title = block.match(/^Title:\s*(.+)$/m)?.[1]?.trim()
    const publishedText = block.match(/^Published:\s*(.+)$/m)?.[1]?.trim()
    const published = publishedText && publishedText !== "N/A" ? Date.parse(publishedText) : undefined
    const content = block.match(/^(?:Highlights|Text):\s*\n?([\s\S]*)$/m)?.[1]?.trim()
    return [
      {
        url,
        ...(title ? { title } : {}),
        ...(content ? { content } : {}),
        ...(published !== undefined && Number.isFinite(published) ? { published } : {}),
      },
    ]
  })
}

/** Shape shared by Parallel and MCP servers that return `structuredContent`. */
export function parseParallelStructured(structured: unknown): SearchResult[] {
  if (!structured || typeof structured !== "object") return []
  const results = (structured as { results?: unknown }).results
  if (!Array.isArray(results)) return []
  return results.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return []
    const item = entry as { url?: unknown; title?: unknown; publish_date?: unknown; excerpts?: unknown }
    if (typeof item.url !== "string") return []
    const published = typeof item.publish_date === "string" ? Date.parse(item.publish_date) : undefined
    const excerpts = Array.isArray(item.excerpts) ? item.excerpts.filter((x) => typeof x === "string") : []
    return [
      {
        url: item.url,
        ...(typeof item.title === "string" ? { title: item.title } : {}),
        ...(excerpts.length ? { content: excerpts.join("\n\n") } : {}),
        ...(published !== undefined && Number.isFinite(published) ? { published } : {}),
      },
    ]
  })
}

/** Render results as the model-facing block. */
export function format(results: readonly SearchResult[]): string {
  return results
    .map((result) => {
      const lines = [result.title ? `${result.title}\n${result.url}` : result.url]
      if (result.published !== undefined) lines.push(`Published: ${new Date(result.published).toISOString().slice(0, 10)}`)
      if (result.content) lines.push("", result.content)
      return lines.join("\n")
    })
    .join("\n\n---\n\n")
}
