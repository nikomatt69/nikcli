import { Schema } from "effect"
import { zod } from "@/util/effect-zod"
import { Tool } from "./tool"
import DESCRIPTION from "./websearch.txt"
import { callTool } from "./mcp-exa"

const DEFAULT_NUM_RESULTS = 8

interface SearchInput extends Record<string, unknown> {
  query: string
  numResults?: number
  livecrawl?: "fallback" | "preferred"
  type?: "auto" | "fast" | "deep"
  contextMaxCharacters?: number
}

const Parameters = Schema.Struct({
  query: Schema.String.annotate({ description: "Websearch query" }),
  numResults: Schema.optional(Schema.Number).annotate({
    description: "Number of search results to return (default: 8)",
  }),
  livecrawl: Schema.optional(Schema.Literals(["fallback", "preferred"])).annotate({
    description:
      "Live crawl mode - 'fallback': use live crawling as backup if cached content unavailable, 'preferred': prioritize live crawling (default: 'fallback')",
  }),
  type: Schema.optional(Schema.Literals(["auto", "fast", "deep"])).annotate({
    description: "Search type - 'auto': balanced search (default), 'fast': quick results, 'deep': comprehensive search",
  }),
  contextMaxCharacters: Schema.optional(Schema.Number).annotate({
    description: "Maximum characters for context string optimized for LLMs (default: 10000)",
  }),
})

export const WebSearchTool = Tool.define("websearch", async () => {
  return {
    get description() {
      return DESCRIPTION.replace("{{date}}", new Date().toISOString().slice(0, 10))
    },
    parameters: zod(Parameters),
    async execute(params, ctx) {
      await ctx.ask({
        permission: "websearch",
        patterns: [params.query],
        always: ["*"],
        metadata: {
          query: params.query,
          numResults: params.numResults,
          livecrawl: params.livecrawl,
          type: params.type,
          contextMaxCharacters: params.contextMaxCharacters,
        },
      })

      const searchInput: SearchInput = {
        query: params.query,
        type: params.type || "auto",
        numResults: params.numResults || DEFAULT_NUM_RESULTS,
        livecrawl: params.livecrawl || "fallback",
        contextMaxCharacters: params.contextMaxCharacters,
      }

      const output = await callTool({
        tool: "web_search_exa",
        args: searchInput,
        timeoutMs: 25000,
        signal: ctx.abort,
      })

      return {
        output: output || "No search results found. Please try a different query.",
        title: `Web search: ${params.query}`,
        metadata: {},
      }
    },
  }
})
