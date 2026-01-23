import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./docs_request.txt"
import { searchDocs } from "@/docs/library"
import { getLoadedDocs, loadDocs } from "@/docs/context"

type DocsRequestMetadata = {
  found: boolean
  loaded: string[]
  suggestions: string[]
  sources: string[]
}

const parameters = z.object({
  concept: z.string().describe("Concept or technology to research"),
  context: z.string().describe("Where you encountered this"),
  urgency: z.enum(["low", "medium", "high"]).optional().default("medium"),
  autoLoad: z.boolean().optional().default(true),
  suggestSources: z.boolean().optional().default(true),
})

export const DocsRequestTool = Tool.define<typeof parameters, DocsRequestMetadata>("docs_request", {
  description: DESCRIPTION,
  parameters,
  async execute(params, ctx) {
    await ctx.ask({
      permission: "docs_request",
      patterns: [params.concept],
      always: ["*"],
      metadata: {
        concept: params.concept,
      },
    })

    const conceptLower = params.concept.toLowerCase()
    const loadedDocs = await getLoadedDocs()
    const relevant = loadedDocs.filter((doc) => {
      const title = doc.title.toLowerCase()
      const content = doc.content.toLowerCase()
      const tags = doc.tags.map((tag) => tag.toLowerCase())
      return (
        title.includes(conceptLower) || content.includes(conceptLower) || tags.some((tag) => tag.includes(conceptLower))
      )
    })

    if (relevant.length > 0) {
      const output = [
        `Found ${relevant.length} loaded docs for: ${params.concept}`,
        "",
        ...relevant.map((doc) => `- ${doc.title} (${doc.id})`),
      ].join("\n")
      return {
        title: "Docs request",
        output,
        metadata: {
          found: true,
          loaded: relevant.map((doc) => doc.id),
          suggestions: [],
          sources: [],
        },
      }
    }

    const results = await searchDocs(params.concept, undefined, 5)
    const suggestions = results.map((result) => result.entry)
    const shouldAutoLoad = params.autoLoad && params.urgency !== "low" && suggestions.length > 0
    const autoIds = shouldAutoLoad ? suggestions.slice(0, 2).map((entry) => entry.id) : []
    const loadResult = autoIds.length > 0 ? await loadDocs(autoIds) : { loaded: [], missing: [] }

    if (suggestions.length > 0) {
      const output = [
        `Found ${suggestions.length} docs for: ${params.concept}`,
        loadResult.loaded.length > 0 ? "Auto-loaded:" : "",
        ...loadResult.loaded.map((doc) => `- ${doc.title} (${doc.id})`),
        loadResult.loaded.length > 0 ? "" : "",
        "Suggestions:",
        ...suggestions.map((doc) => `- ${doc.title} (${doc.id})`),
        "",
        `Context: ${params.context}`,
      ]
        .filter(Boolean)
        .join("\n")

      return {
        title: "Docs request",
        output,
        metadata: {
          found: true,
          loaded: loadResult.loaded.map((doc) => doc.id),
          suggestions: suggestions.map((doc) => doc.id),
          sources: [],
        },
      }
    }

    const sources = params.suggestSources ? buildSources(params.concept) : []
    const output = [
      `No local docs found for: ${params.concept}`,
      `Context: ${params.context}`,
      sources.length > 0 ? "Suggested sources:" : "",
      ...sources.map((source) => `- ${source}`),
    ]
      .filter(Boolean)
      .join("\n")

    return {
      title: "Docs request",
      output,
      metadata: {
        found: false,
        loaded: [],
        suggestions: [],
        sources,
      },
    }
  },
})

function buildSources(concept: string): string[] {
  const items: string[] = []
  const lower = concept.toLowerCase()
  if (lower.includes("react")) items.push("https://react.dev/")
  if (lower.includes("typescript") || lower.includes("ts")) items.push("https://www.typescriptlang.org/docs/")
  if (lower.includes("node")) items.push("https://nodejs.org/docs/")
  if (lower.includes("next")) items.push("https://nextjs.org/docs")
  items.push(`https://developer.mozilla.org/en-US/search?q=${encodeURIComponent(concept)}`)
  items.push(`https://stackoverflow.com/search?q=${encodeURIComponent(concept)}`)
  return items
}
