import z from "zod"
import path from "path"
import { mkdir } from "fs/promises"
import { randomUUID } from "crypto"
import { Tool } from "./tool"
import DESCRIPTION from "./docs_gap_report.txt"
import { Global } from "@/global"

type GapEntry = {
  id: string
  concept: string
  frequency: string
  impact: string
  userContext: string
  suggestedSources: string[]
  reportedAt: number
}

const parameters = z.object({
  missingConcept: z.string().describe("Missing concept"),
  frequency: z.enum(["first-time", "occasional", "frequent", "blocking"]).describe("How often this is seen"),
  impact: z.enum(["low", "medium", "high", "critical"]).describe("Impact level"),
  suggestedSources: z.array(z.string()).optional().describe("Suggested source URLs"),
  userContext: z.string().describe("User context where this happened"),
})

const DIR = path.join(Global.Path.data, "docs")
const FILE = path.join(DIR, "gaps.json")

export const DocsGapReportTool = Tool.define("docs_gap_report", {
  description: DESCRIPTION,
  parameters,
  async execute(params, ctx) {
    await ctx.ask({
      permission: "docs_gap_report",
      patterns: [params.missingConcept],
      always: ["*"],
      metadata: {
        missingConcept: params.missingConcept,
      },
    })

    const entry: GapEntry = {
      id: randomUUID(),
      concept: params.missingConcept,
      frequency: params.frequency,
      impact: params.impact,
      userContext: params.userContext,
      suggestedSources: params.suggestedSources ?? [],
      reportedAt: Date.now(),
    }

    await mkdir(DIR, { recursive: true })
    const existing = await Bun.file(FILE)
      .json()
      .catch(() => [])
      .then((data) => (Array.isArray(data) ? data : []))
    const next = [entry, ...existing]
    await Bun.write(FILE, JSON.stringify(next, null, 2))

    const output = [
      "Documentation gap recorded.",
      `Concept: ${entry.concept}`,
      `Impact: ${entry.impact}`,
      `Frequency: ${entry.frequency}`,
      entry.suggestedSources.length > 0 ? `Sources: ${entry.suggestedSources.join(", ")}` : "",
    ]
      .filter(Boolean)
      .join("\n")

    return {
      title: "Docs gap report",
      output,
      metadata: {
        id: entry.id,
      },
    }
  },
})
