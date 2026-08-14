import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./memory_search.txt"
import { SessionRepo } from "@/session/repo"
import { Instance } from "@/project/instance"
import { MessageV2 } from "@/session/message-v2"

const parameters = z.object({
  query: z.string().describe("Search query"),
  limit: z.number().int().min(1).max(50).optional().describe("Maximum results"),
  sessionId: z.string().optional().describe("Restrict to a single session"),
  maxSessions: z.number().int().min(1).max(50).optional().describe("Maximum sessions to scan"),
  maxMessages: z.number().int().min(1).max(500).optional().describe("Maximum messages to scan"),
})

type Result = {
  sessionID: string
  messageID: string
  score: number
  role: string
  snippet: string
  time: number
}

export const MemorySearchTool = Tool.define<typeof parameters, { count: number }>("memory_search", {
  description: DESCRIPTION,
  parameters,
  async execute(params, ctx) {
    const limit = params.limit ?? 10
    const maxSessions = params.maxSessions ?? 10
    const maxMessages = params.maxMessages ?? 200
    const terms = splitTerms(params.query)

    await ctx.ask({
      permission: "memory_search",
      patterns: [params.query],
      always: ["*"],
      metadata: {
        query: params.query,
        limit,
        sessionId: params.sessionId,
        maxSessions,
        maxMessages,
      },
    })

    if (terms.length === 0) {
      return {
        title: "Memory search",
        output: "No search terms provided.",
        metadata: { count: 0 },
      }
    }

    const sessions = await collectSessions(params.sessionId, maxSessions)
    const results: Result[] = []
    const counter = { value: 0 }

    for (const sessionID of sessions) {
      if (results.length >= limit) break
      for await (const msg of MessageV2.stream(sessionID)) {
        if (results.length >= limit) break
        if (counter.value >= maxMessages) break
        counter.value += 1

        for (const part of msg.parts) {
          if (part.type !== "text") continue
          if (part.ignored) continue
          // Lower-case the text once and reuse for both scoring and snippet.
          // (Previously `scoreText` and `makeSnippet` each called `text.toLowerCase()`
          // on the same string, doubling the per-part CPU cost.)
          const lower = part.text.toLowerCase()
          const score = scoreText(lower, terms)
          if (score <= 0) continue
          results.push({
            sessionID: msg.info.sessionID,
            messageID: msg.info.id,
            score,
            role: msg.info.role,
            snippet: makeSnippet(part.text, lower, terms),
            time: msg.info.time.created,
          })
          if (results.length >= limit) break
        }
      }
    }

    if (results.length === 0) {
      return {
        title: "Memory search",
        output: "No matches found.",
        metadata: { count: 0 },
      }
    }

    results.sort((a, b) => b.score - a.score || b.time - a.time)

    const lines = results.slice(0, limit).map((item) => {
      const score = item.score.toFixed(2)
      return `- [${score}] ${item.role} ${item.sessionID} ${item.messageID}: ${item.snippet}`
    })

    return {
      title: "Memory search",
      output: lines.join("\n"),
      metadata: { count: results.length },
    }
  },
})

function splitTerms(query: string) {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
}

function scoreText(lower: string, terms: string[]) {
  const hits = terms.reduce((sum, term) => sum + (lower.includes(term) ? 1 : 0), 0)
  if (hits === 0) return 0
  return hits / terms.length
}

function makeSnippet(text: string, lower: string, terms: string[]) {
  const indexes = terms
    .map((term) => lower.indexOf(term))
    .filter((value) => value >= 0)
    .sort((a, b) => a - b)
  const idx = indexes[0]
  if (idx === undefined) return text.slice(0, 180).replace(/\s+/g, " ").trim()
  const start = Math.max(0, idx - 80)
  const end = Math.min(text.length, idx + 120)
  return text.slice(start, end).replace(/\s+/g, " ").trim()
}

async function collectSessions(sessionId: string | undefined, max: number) {
  if (sessionId) return [sessionId]
  const project = Instance.project
  const ids = SessionRepo.getByProject(project.id).map((session) => session.id)
  return ids.slice(0, max)
}
