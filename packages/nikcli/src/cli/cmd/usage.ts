import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { Session } from "../../session"
import { bootstrap } from "../bootstrap"
import { Storage } from "../../storage/storage"
import { Project } from "../../project/project"
import { Instance } from "../../project/instance"
import { Effect } from "effect"
import { runPromiseWithLayer, withCurrentInstance } from "@/effect"
import { Log } from "@/util/log"
import z from "zod"

const log = Log.create({ service: "usage-command" })

function runStorage<A, E>(effect: Effect.Effect<A, E, Storage.Service>): Promise<A> {
  return runPromiseWithLayer(Storage.defaultLayer, effect)
}

function runSession<A, E>(effect: Effect.Effect<A, E, Session.Service>): Promise<A> {
  return runPromiseWithLayer(Session.defaultLayer, withCurrentInstance(effect))
}

function storageRead<T>(key: string[]) {
  return runStorage(
    Effect.gen(function* () {
      const storage = yield* Storage.Service
      return yield* storage.read<T>(key)
    }),
  )
}

function storageList(prefix: string[]) {
  return runStorage(
    Effect.gen(function* () {
      const storage = yield* Storage.Service
      return yield* storage.list(prefix)
    }),
  )
}

// ============================================
// Schemas
// ============================================

const TokenBreakdownSchema = z.object({
  input: z.number(),
  output: z.number(),
  reasoning: z.number(),
  cache: z.object({
    read: z.number(),
    write: z.number(),
  }),
})

const MessageSchema = z.object({
  id: z.string(),
  sessionID: z.string(),
  time: z.object({
    created: z.number(),
    updated: z.number(),
  }),
  info: z.object({
    role: z.enum(["user", "assistant", "system"]),
    tokens: TokenBreakdownSchema.optional(),
    cost: z.number().optional(),
    providerID: z.string().optional(),
    modelID: z.string().optional(),
    finishReason: z.string().optional(),
  }),
  parts: z.array(z.any()),
})

const SessionSchema = z.object({
  id: z.string(),
  projectID: z.string(),
  name: z.string().optional(),
  time: z.object({
    created: z.number(),
    updated: z.number(),
  }),
})

// ============================================
// Types
// ============================================

interface UsageStats {
  sessionCount: number
  totalTokens: {
    input: number
    output: number
    reasoning: number
    cache: {
      read: number
      write: number
    }
  }
  totalCost: number
  duration: number
  avgTokensPerSession: number
  avgCostPerSession: number
  tokensByDay: Array<{
    date: string
    input: number
    output: number
    reasoning: number
    cache: number
    total: number
  }>
  modelBreakdown: Array<{
    model: string
    messages: number
    input: number
    output: number
    reasoning: number
    cost: number
  }>
}

interface SessionUsage {
  sessionID: string
  name: string
  messages: number
  duration: number
  tokens: {
    input: number
    output: number
    reasoning: number
    cache: number
  }
  cost: number
  model: string
  date: Date
}

// ============================================
// Command Definition
// ============================================

export const UsageCommand = cmd({
  command: "usage",
  describe: "show token usage with charts and visual breakdowns",
  builder: (yargs: Argv) => {
    return yargs
      .option("days", {
        describe: "show usage for the last N days (default: 7)",
        type: "number",
        default: 7,
      })
      .option("top", {
        describe: "show top N sessions (default: 10)",
        type: "number",
        default: 10,
      })
      .option("models", {
        describe: "show model breakdown (default: true)",
        type: "boolean",
        default: true,
      })
      .option("project", {
        describe: "filter by project (default: current project)",
        type: "string",
      })
      .option("no-chart", {
        describe: "disable ASCII charts",
        type: "boolean",
        default: false,
      })
  },
  handler: async (args) => {
    log.debug("Usage command started", {
      days: args.days,
      top: args.top,
      project: args.project,
    })

    await bootstrap(process.cwd(), async () => {
      const stats = await aggregateUsageStats(args.days, args.project)
      const sessions = await getTopSessions(args.days, args.project, args.top)

      displayUsage(stats, sessions, {
        days: args.days,
        top: args.top,
        models: args.models,
        chart: !args["no-chart"],
      })
    })
  },
})

// ============================================
// Data Aggregation
// ============================================

async function getTopSessions(days: number, projectFilter: string | undefined, limit: number): Promise<SessionUsage[]> {
  const sessions = await getAllSessions()
  const MS_IN_DAY = 24 * 60 * 60 * 1000
  const cutoffTime = Date.now() - days * MS_IN_DAY

  let filteredSessions = days > 0 ? sessions.filter((session) => session.time.updated >= cutoffTime) : sessions

  if (projectFilter !== undefined) {
    const currentProject = await Instance.project
    if (projectFilter === "") {
      filteredSessions = filteredSessions.filter((session) => session.projectID === currentProject.id)
    } else {
      filteredSessions = filteredSessions.filter((session) => session.projectID === projectFilter)
    }
  }

  const sessionUsages: SessionUsage[] = []

  for (const session of filteredSessions.slice(0, limit * 2)) {
    try {
      const messages = await runSession(
        Effect.gen(function* () {
          const sessionService = yield* Session.Service
          return yield* sessionService.messages({ sessionID: session.id })
        }),
      )

      let totalTokens = { input: 0, output: 0, reasoning: 0, cache: 0 }
      let totalCost = 0
      let model = "unknown"
      let hasAssistant = false

      for (const message of messages) {
        if (message.info.role === "assistant") {
          hasAssistant = true
          if (message.info.tokens) {
            totalTokens.input += message.info.tokens.input || 0
            totalTokens.output += message.info.tokens.output || 0
            totalTokens.reasoning += message.info.tokens.reasoning || 0
            totalTokens.cache += (message.info.tokens.cache?.read || 0) + (message.info.tokens.cache?.write || 0)
          }
          if (message.info.cost) {
            totalCost += message.info.cost
          }
          if (message.info.modelID) {
            model = message.info.modelID
          }
        }
      }

      if (hasAssistant) {
        const lastMsg = messages[messages.length - 1]
        const firstMsg = messages[0]
        const lastCreated = lastMsg?.info && "time" in lastMsg.info ? lastMsg.info.time.created : 0
        const firstCreated = firstMsg?.info && "time" in firstMsg.info ? firstMsg.info.time.created : 0
        const duration = lastCreated && firstCreated ? Math.max(0, lastCreated - firstCreated) : 0

        sessionUsages.push({
          sessionID: session.id,
          name: session.name || session.id.slice(-8),
          messages: messages.length,
          duration,
          tokens: totalTokens,
          cost: totalCost,
          model,
          date: new Date(session.time.updated),
        })
      }
    } catch  {
      // Skip sessions that fail to load
    }
  }

  return sessionUsages
    .sort((a, b) => b.tokens.input + b.tokens.output - (a.tokens.input + a.tokens.output))
    .slice(0, limit)
}

async function aggregateUsageStats(days: number, projectFilter: string | undefined): Promise<UsageStats> {
  const sessions = await getAllSessions()
  const MS_IN_DAY = 24 * 60 * 60 * 1000
  const cutoffTime = days > 0 ? Date.now() - days * MS_IN_DAY : 0

  let filteredSessions = cutoffTime > 0 ? sessions.filter((session) => session.time.updated >= cutoffTime) : sessions

  if (projectFilter !== undefined) {
    const currentProject = await Instance.project
    if (projectFilter === "") {
      filteredSessions = filteredSessions.filter((session) => session.projectID === currentProject.id)
    } else {
      filteredSessions = filteredSessions.filter((session) => session.projectID === projectFilter)
    }
  }

  const stats: UsageStats = {
    sessionCount: filteredSessions.length,
    totalTokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    totalCost: 0,
    duration: 0,
    avgTokensPerSession: 0,
    avgCostPerSession: 0,
    tokensByDay: [],
    modelBreakdown: [],
  }

  if (filteredSessions.length === 0) {
    return stats
  }

  const modelMap = new Map<
    string,
    { messages: number; input: number; output: number; reasoning: number; cost: number }
  >()
  const dayMap = new Map<string, { input: number; output: number; reasoning: number; cache: number; total: number }>()

  let totalSessionTokens = 0

  for (const session of filteredSessions) {
    try {
      const messages = await runSession(
        Effect.gen(function* () {
          const sessionService = yield* Session.Service
          return yield* sessionService.messages({ sessionID: session.id })
        }),
      )

      let sessionTokens = { input: 0, output: 0, reasoning: 0, cache: 0 }
      let sessionCost = 0
      let model = "unknown"

      for (const message of messages) {
        if (message.info.role === "assistant") {
          if (message.info.tokens) {
            sessionTokens.input += message.info.tokens.input || 0
            sessionTokens.output += message.info.tokens.output || 0
            sessionTokens.reasoning += message.info.tokens.reasoning || 0
            sessionTokens.cache += (message.info.tokens.cache?.read || 0) + (message.info.tokens.cache?.write || 0)
          }
          if (message.info.cost) {
            sessionCost += message.info.cost
          }
          if (message.info.modelID) {
            model = message.info.modelID
          }
        }
      }

      stats.totalTokens.input += sessionTokens.input
      stats.totalTokens.output += sessionTokens.output
      stats.totalTokens.reasoning += sessionTokens.reasoning
      stats.totalTokens.cache.read += Math.floor(sessionTokens.cache / 2)
      stats.totalTokens.cache.write += Math.floor(sessionTokens.cache / 2)
      stats.totalCost += sessionCost
      totalSessionTokens += sessionTokens.input + sessionTokens.output + sessionTokens.reasoning

      // Update model breakdown
      const existing = modelMap.get(model) || {
        messages: 0,
        input: 0,
        output: 0,
        reasoning: 0,
        cost: 0,
      }
      existing.messages++
      existing.input += sessionTokens.input
      existing.output += sessionTokens.output
      existing.reasoning += sessionTokens.reasoning
      existing.cost += sessionCost
      modelMap.set(model, existing)

      // Update day breakdown
      const dateKey = new Date(session.time.updated).toISOString().split("T")[0]
      const dayData = dayMap.get(dateKey) || {
        input: 0,
        output: 0,
        reasoning: 0,
        cache: 0,
        total: 0,
      }
      dayData.input += sessionTokens.input
      dayData.output += sessionTokens.output
      dayData.reasoning += sessionTokens.reasoning
      dayData.cache += sessionTokens.cache
      dayData.total += sessionTokens.input + sessionTokens.output + sessionTokens.reasoning + sessionTokens.cache
      dayMap.set(dateKey, dayData)
    } catch {
      // Skip failed sessions
    }
  }

  // Convert maps to sorted arrays
  stats.tokensByDay = Array.from(dayMap.entries())
    .map(([date, data]) => ({ date, ...data }))
    .sort((a, b) => a.date.localeCompare(b.date))

  stats.modelBreakdown = Array.from(modelMap.entries())
    .map(([model, data]) => ({ model, ...data }))
    .sort((a, b) => b.input + b.output - (a.input + a.output))

  stats.avgTokensPerSession = filteredSessions.length > 0 ? totalSessionTokens / filteredSessions.length : 0
  stats.avgCostPerSession = filteredSessions.length > 0 ? stats.totalCost / filteredSessions.length : 0

  return stats
}

// ============================================
// Display Functions
// ============================================

interface DisplayArgs {
  days: number
  top: number
  models: boolean
  chart: boolean
}

function displayUsage(stats: UsageStats, sessions: SessionUsage[], args: DisplayArgs): void {
  const WIDTH = 68
  const CHART_WIDTH = 40

  // Header
  console.log()
  console.log("  \x1b[1;36m┌" + "─".repeat(WIDTH - 2) + "┐\x1b[0m")
  console.log(`  \x1b[1;36m│\x1b[0m \x1b[1;37mUSAGE OVERVIEW\x1b[0m${" ".repeat(WIDTH - 19)}\x1b[1;36m│\x1b[0m`)
  console.log("  \x1b[1;36m├" + "─".repeat(WIDTH - 2) + "┤\x1b[0m")

  // Stats row
  const statsLine1 = `Sessions: ${stats.sessionCount}  |  Days: ${args.days}  |  Cost: $${stats.totalCost.toFixed(2)}`
  console.log(`  \x1b[1;36m│\x1b[0m ${statsLine1.padEnd(WIDTH - 4)} \x1b[1;36m│\x1b[0m`)
  console.log("  \x1b[1;36m└" + "─".repeat(WIDTH - 2) + "┘\x1b[0m")

  // Token summary
  console.log()
  const totalTokens = stats.totalTokens.input + stats.totalTokens.output + stats.totalTokens.reasoning
  const cacheTotal = stats.totalTokens.cache.read + stats.totalTokens.cache.write

  console.log("  \x1b[1;33m┌─ TOKEN BREAKDOWN ────────────────────────────────────────────┐\x1b[0m")

  const inputPct = totalTokens > 0 ? ((stats.totalTokens.input / totalTokens) * 100).toFixed(1) : "0"
  const outputPct = totalTokens > 0 ? ((stats.totalTokens.output / totalTokens) * 100).toFixed(1) : "0"
  const reasonPct = totalTokens > 0 ? ((stats.totalTokens.reasoning / totalTokens) * 100).toFixed(1) : "0"

  console.log(
    `  \x1b[1;33m│\x1b[0m   \x1b[32minput\x1b[0m   ${formatTokens(stats.totalTokens.input).padStart(8)} ${renderMiniBar(parseFloat(inputPct), CHART_WIDTH - 30)} \x1b[32m${inputPct}%\x1b[0m`,
  )
  console.log(
    `  \x1b[1;33m│\x1b[0m   \x1b[31moutput\x1b[0m  ${formatTokens(stats.totalTokens.output).padStart(8)} ${renderMiniBar(parseFloat(outputPct), CHART_WIDTH - 30)} \x1b[31m${outputPct}%\x1b[0m`,
  )
  console.log(
    `  \x1b[1;33m│\x1b[0m   \x1b[35mreason\x1b[0m  ${formatTokens(stats.totalTokens.reasoning).padStart(8)} ${renderMiniBar(parseFloat(reasonPct), CHART_WIDTH - 30)} \x1b[35m${reasonPct}%\x1b[0m`,
  )
  console.log("  \x1b[1;33m├─────────────────────────────────────────────────────────────┤\x1b[0m")
  console.log(
    `  \x1b[1;33m│\x1b[0m   \x1b[36mcache\x1b[0m  ${formatTokens(cacheTotal).padStart(8)} (r: ${formatTokens(stats.totalTokens.cache.read)} / w: ${formatTokens(stats.totalTokens.cache.write)})\x1b[0m`,
  )
  console.log(
    `  \x1b[1;33m│\x1b[0m   \x1b[37mtotal\x1b[0m   ${formatTokens(totalTokens).padStart(8)}${" ".repeat(CHART_WIDTH - 8)}\x1b[0m`,
  )
  console.log("  \x1b[1;33m└─────────────────────────────────────────────────────────────┘\x1b[0m")

  // Daily chart
  if (args.chart && stats.tokensByDay.length > 0) {
    console.log()
    console.log("  \x1b[1;34m┌─ TOKENS BY DAY ─────────────────────────────────────────────┐\x1b[0m")
    console.log("  \x1b[1;34m│\x1b[0m                                                           \x1b[1;34m│\x1b[0m")

    const maxTotal = Math.max(...stats.tokensByDay.map((d) => d.total), 1)
    const displayDays = stats.tokensByDay.slice(-14) // Last 14 days

    for (const day of displayDays) {
      const barWidth = Math.max(1, Math.floor((day.total / maxTotal) * (CHART_WIDTH - 25)))
      const dateStr = day.date.slice(5) // MM-DD
      const totalStr = formatTokens(day.total).padStart(6)

      // Calculate stacked bar segments
      const total = day.input + day.output + day.reasoning
      const inputWidth = total > 0 ? Math.floor((day.input / total) * barWidth) : 0
      const outputWidth = total > 0 ? Math.floor((day.output / total) * barWidth) : 0
      const reasonWidth = barWidth - inputWidth - outputWidth

      const inputBar = "\x1b[32m" + "█".repeat(inputWidth) + "\x1b[0m"
      const outputBar = "\x1b[31m" + "█".repeat(outputWidth) + "\x1b[0m"
      const reasonBar = "\x1b[35m" + "█".repeat(Math.max(0, reasonWidth)) + "\x1b[0m"

      console.log(
        `  \x1b[1;34m│\x1b[0m ${dateStr} ${inputBar}${outputBar}${reasonBar}${" ".repeat(Math.max(0, CHART_WIDTH - 25 - barWidth))} ${totalStr} \x1b[1;34m│\x1b[0m`,
      )
    }

    console.log("  \x1b[1;34m│\x1b[0m                                                           \x1b[1;34m│\x1b[0m")
    console.log(
      `  \x1b[1;34m│\x1b[0m   \x1b[32m██\x1b[0m input  \x1b[31m██\x1b[0m output  \x1b[35m██\x1b[0m reason                         \x1b[1;34m│\x1b[0m`,
    )
    console.log("  \x1b[1;34m└─────────────────────────────────────────────────────────────┘\x1b[0m")
  }

  // Model breakdown
  if (args.models && stats.modelBreakdown.length > 0) {
    console.log()
    console.log("  \x1b[1;32m┌─ MODEL BREAKDOWN ────────────────────────────────────────────┐\x1b[0m")

    for (const model of stats.modelBreakdown.slice(0, 5)) {
      const modelShort = model.model.length > 40 ? model.model.slice(0, 37) + "..." : model.model
      const tokens = formatTokens(model.input + model.output)
      const cost = `$${model.cost.toFixed(3)}`

      console.log(`  \x1b[1;32m│\x1b[0m   \x1b[37m${modelShort}\x1b[0m`)
      console.log(
        `  \x1b[1;32m│\x1b[0m     msgs: ${model.messages.toString().padStart(3)}  tokens: ${tokens.padStart(8)}  cost: ${cost.padStart(8)} \x1b[1;32m│\x1b[0m`,
      )
    }
    console.log("  \x1b[1;32m└─────────────────────────────────────────────────────────────┘\x1b[0m")
  }

  // Top sessions
  if (sessions.length > 0) {
    console.log()
    console.log("  \x1b[1;36m┌─ TOP SESSIONS ──────────────────────────────────────────────┐\x1b[0m")
    console.log("  \x1b[1;36m│\x1b[0m                                                           \x1b[1;36m│\x1b[0m")

    const maxTokens = Math.max(...sessions.map((s) => s.tokens.input + s.tokens.output), 1)

    for (const session of sessions.slice(0, args.top)) {
      const totalTokens = session.tokens.input + session.tokens.output + session.tokens.reasoning
      const barWidth = Math.max(1, Math.floor((totalTokens / maxTokens) * (CHART_WIDTH - 10)))

      const inputWidth = Math.floor((session.tokens.input / totalTokens) * barWidth)
      const outputWidth = Math.floor((session.tokens.output / totalTokens) * barWidth)
      const reasonWidth = barWidth - inputWidth - outputWidth

      const bar =
        "\x1b[32m" +
        "█".repeat(inputWidth) +
        "\x1b[0m" +
        "\x1b[31m" +
        "█".repeat(outputWidth) +
        "\x1b[0m" +
        "\x1b[35m" +
        "█".repeat(Math.max(0, reasonWidth)) +
        "\x1b[0m"

      const tokensStr = formatTokens(totalTokens)
      const costStr = `$${session.cost.toFixed(2)}`
      const dateStr = session.date.toLocaleDateString("en-US", { month: "short", day: "numeric" })

      console.log(
        `  \x1b[1;36m│\x1b[0m ${dateStr} ${session.name.padEnd(10)} ${bar} ${tokensStr.padStart(6)} ${costStr.padStart(7)} \x1b[1;36m│\x1b[0m`,
      )
    }

    console.log("  \x1b[1;36m│\x1b[0m                                                           \x1b[1;36m│\x1b[0m")
    console.log(
      `  \x1b[1;36m│\x1b[0m   \x1b[32m██\x1b[0m input  \x1b[31m██\x1b[0m output  \x1b[35m██\x1b[0m reason                         \x1b[1;36m│\x1b[0m`,
    )
    console.log("  \x1b[1;36m└─────────────────────────────────────────────────────────────┘\x1b[0m")
  }

  console.log()
}

// ============================================
// Helpers
// ============================================

function formatTokens(num: number): string {
  if (!Number.isFinite(num)) return "0"
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + "M"
  } else if (num >= 1000) {
    return (num / 1000).toFixed(1) + "K"
  }
  return Math.round(num).toString()
}

function renderMiniBar(percentage: number, width: number): string {
  const filled = Math.max(1, Math.floor((percentage / 100) * width))
  return "\x1b[36m" + "█".repeat(filled) + "\x1b[0m" + "░".repeat(Math.max(0, width - filled))
}

async function getAllSessions(): Promise<z.infer<typeof SessionSchema>[]> {
  const sessions: z.infer<typeof SessionSchema>[] = []

  try {
    const projectKeys = await storageList(["project"])
    const projects = await Promise.all(
      projectKeys.map(async (key) => {
        try {
          return await storageRead<Project.Info>(key)
        } catch {
          return undefined
        }
      }),
    )

    for (const project of projects) {
      if (!project?.id) continue

      const sessionKeys = await storageList(["session", project.id])
      const projectSessions = await Promise.all(
        sessionKeys.map(async (key) => {
          try {
            return await storageRead(key)
          } catch {
            return undefined
          }
        }),
      )

      for (const session of projectSessions) {
        if (session && typeof session === "object" && "id" in session && "projectID" in session && "time" in session) {
          sessions.push(session as Session.Info)
        }
      }
    }
  } catch (error) {
    log.error("Failed to get all sessions", { error })
  }

  return sessions
}
