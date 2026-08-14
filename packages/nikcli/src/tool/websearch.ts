import { Schema } from "effect"
import { zod } from "@nikcli-ai/util/effect-zod"
import { Tool } from "./tool"
import DESCRIPTION from "./websearch.txt"
import { Config } from "@/config/config"
import { runPromiseWithLayer, withCurrentInstance } from "@/effect"
import { Effect } from "effect"
import { DEFAULT_NUM_RESULTS, ProviderConfigError, format, resolve } from "./websearch/provider"

const Parameters = Schema.Struct({
  query: Schema.String.annotate({ description: "Websearch query" }),
  numResults: Schema.optional(Schema.Number).annotate({
    description: "Number of search results to return (default: 8)",
  }),
  livecrawl: Schema.optional(Schema.Literals(["fallback", "preferred"])).annotate({
    description:
      "Live crawl mode - 'fallback': use live crawling as backup if cached content unavailable, 'preferred': prioritize live crawling (default: 'fallback'). Exa only.",
  }),
  type: Schema.optional(Schema.Literals(["auto", "fast", "deep"])).annotate({
    description:
      "Search type - 'auto': balanced search (default), 'fast': quick results, 'deep': comprehensive search. Exa only.",
  }),
  contextMaxCharacters: Schema.optional(Schema.Number).annotate({
    description: "Maximum characters for context string optimized for LLMs (default: 10000). Exa only.",
  }),
})

function websearchConfig() {
  return runPromiseWithLayer(
    Config.defaultLayer,
    withCurrentInstance(
      Effect.gen(function* () {
        const config = yield* Config.Service
        const cfg = yield* config.get()
        return cfg.websearch ?? {}
      }),
    ),
  )
}

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

      const provider = resolve(await websearchConfig())

      let results
      try {
        results = await provider.search({
          query: params.query,
          numResults: params.numResults ?? DEFAULT_NUM_RESULTS,
          livecrawl: params.livecrawl,
          type: params.type,
          contextMaxCharacters: params.contextMaxCharacters,
          signal: ctx.abort,
        })
      } catch (error) {
        // A misconfigured provider is the user's to fix, not something the model
        // should retry or work around, so say which provider and what is missing.
        if (error instanceof ProviderConfigError) throw error
        throw new Error(`${provider.name} web search failed: ${error instanceof Error ? error.message : error}`)
      }

      return {
        output: results.length > 0 ? format(results) : "No search results found. Please try a different query.",
        title: `Web search: ${params.query}`,
        metadata: { provider: provider.id, results: results.length },
      }
    },
  }
})
