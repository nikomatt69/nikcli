import type { Session, Message, Part, Todo, Workspace } from "@nikcli-ai/sdk/v2"
import type { SessionAnalytics } from "@/analytics/analytics"

export interface BackgroundJob {
  jobID: string
  rootDelegationID: string
  parentSessionID: string
  title: string
  agent: string
  status: "running" | "synthesizing" | "complete" | "error" | "timeout" | "cancelled" | "orphaned"
  source?: string
  workerSessionID?: string
  delegatorID?: string
  delegatorSessionID?: string
  createdAt: number
  updatedAt: number
  completedAt?: number
  lastActivityAt?: number
  progressSummary?: string
  resultSummary?: string
  error?: string
}

export interface SyncData {
  session: Session[]
  message: Record<string, Message[]>
  part: Record<string, Part[]>
  todo: Record<string, Todo[]>
  workspaceList: Workspace[]
  background_job: Record<string, BackgroundJob[]>
}

export interface SessionStats {
  sessionID: string
  title: string
  directory: string
  messages: number
  tokens: { input: number; output: number; reasoning: number; cacheRead: number; cacheWrite: number }
  cost: number
  model: string
  provider: string
  updated: number
  created: number
  duration: number
}

function sessionAnalyticsToStats(s: SessionAnalytics): SessionStats {
  return {
    sessionID: s.sessionID,
    title: s.title,
    directory: s.directory,
    messages: s.messages,
    tokens: {
      input: s.tokens.input,
      output: s.tokens.output,
      reasoning: s.tokens.reasoning,
      cacheRead: s.tokens.cacheRead,
      cacheWrite: s.tokens.cacheWrite,
    },
    cost: s.cost,
    model: s.modelID,
    provider: s.providerID,
    updated: s.time.completed,
    created: s.time.created,
    duration: s.duration,
  }
}

/** Fill gaps from GET /analytics/sessions; same id uses per-field max (live vs persisted). */
export function mergeSessionsFromApi(live: SessionStats[], fromApi: SessionAnalytics[]): SessionStats[] {
  const byId = new Map<string, SessionStats>()
  for (const row of live) {
    byId.set(row.sessionID, { ...row })
  }
  for (const a of fromApi) {
    const apiRow = sessionAnalyticsToStats(a)
    const ex = byId.get(a.sessionID)
    if (!ex) {
      byId.set(a.sessionID, apiRow)
    } else {
      byId.set(a.sessionID, {
        ...ex,
        messages: Math.max(ex.messages, apiRow.messages),
        tokens: {
          input: Math.max(ex.tokens.input, apiRow.tokens.input),
          output: Math.max(ex.tokens.output, apiRow.tokens.output),
          reasoning: Math.max(ex.tokens.reasoning, apiRow.tokens.reasoning),
          cacheRead: Math.max(ex.tokens.cacheRead, apiRow.tokens.cacheRead),
          cacheWrite: Math.max(ex.tokens.cacheWrite, apiRow.tokens.cacheWrite),
        },
        cost: Math.max(ex.cost, apiRow.cost),
        duration: Math.max(ex.duration, apiRow.duration),
        updated: Math.max(ex.updated, apiRow.updated),
        created: Math.min(ex.created, apiRow.created),
        title: ex.title || apiRow.title,
        directory: ex.directory || apiRow.directory,
        model: ex.model || apiRow.model,
        provider: ex.provider || apiRow.provider,
      })
    }
  }
  return Array.from(byId.values()).sort((a, b) => {
    const at = a.tokens.input + a.tokens.output + a.tokens.reasoning
    const bt = b.tokens.input + b.tokens.output + b.tokens.reasoning
    return bt - at
  })
}

export interface ProviderStats {
  providerID: string
  sessions: number
  messages: number
  tokens: { input: number; output: number; reasoning: number; cache: number }
  cost: number
  models: Set<string>
}

export interface ModelStats {
  key: string
  providerID: string
  modelID: string
  sessions: number
  messages: number
  tokens: { input: number; output: number; reasoning: number; cacheRead: number; cacheWrite: number }
  cost: number
  firstUsed: number
  lastUsed: number
}

export interface GlobalStats {
  sessions: number
  archivedSessions: number
  messages: number
  tokens: { input: number; output: number; reasoning: number; cacheRead: number; cacheWrite: number }
  cost: number
  projects: ProjectStats[]
  workspaces: WorkspaceStats
  backgroundRuns: BackgroundRunStats
  toolUsage: ToolUsageStats
  todos: TodoStats
  efficiency: EfficiencyMetrics
}

export interface ProjectStats {
  id: string
  name: string
  vcs: "git" | "local" | "unknown"
  sessionCount: number
  workspaceCount: number
  totalCost: number
  totalTokens: number
  created: number
  lastActive: number
}

export interface WorkspaceStats {
  total: number
  active: number
  disconnected: number
  byType: Record<string, number>
}

export interface BackgroundRunStats {
  total: number
  running: number
  completed: number
  error: number
  cancelled: number
  successRate: number
  avgDuration: number
  topAgents: { agent: string; count: number }[]
}

export interface ToolUsageStats {
  total: number
  tools: { name: string; count: number; successRate: number }[]
  mostUsed: { name: string; count: number; successRate: number }[]
}

export interface TodoStats {
  total: number
  pending: number
  inProgress: number
  completed: number
  cancelled: number
  completionRate: number
  byPriority: { priority: string; count: number }[]
}

export interface EfficiencyMetrics {
  costPer1kTokens: number
  costPerSession: number
  avgTokensPerSession: number
  avgCostPerDay: number
}

export interface DayStats {
  date: string
  sessions: number
  tokens: number
  input: number
  output: number
  reasoning: number
  cacheRead: number
  cacheWrite: number
  cost: number
  messages: number
  // Map<modelKey, modelRow> for O(1) lookups during aggregation; preserved as Map in the
  // public type since no external consumer mutates it (they only iterate / map / clone).
  models: Map<string, { modelKey: string; tokens: number; cost: number; messages: number }>
}

export interface AggregatedStats {
  global: GlobalStats
  projects: ProjectStats[]
  workspaces: WorkspaceStats
  sessions: SessionStats[]
  providers: Map<string, ProviderStats>
  models: ModelStats[]
  days: DayStats[]
  backgroundRuns: BackgroundRunStats
  toolUsage: ToolUsageStats
  todos: TodoStats
}

function dateKey(timestamp: number): string {
  return new Date(timestamp).toISOString().split("T")[0]
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setUTCDate(next.getUTCDate() + days)
  return next
}

function emptyDayStats(date: string): DayStats {
  return {
    date,
    sessions: 0,
    tokens: 0,
    input: 0,
    output: 0,
    reasoning: 0,
    cacheRead: 0,
    cacheWrite: 0,
    cost: 0,
    messages: 0,
    models: new Map(),
  }
}

function getDayStats(dayMap: Map<string, DayStats>, date: string): DayStats {
  return dayMap.get(date) || emptyDayStats(date)
}

function fillDailyRange(days: DayStats[], limit: number): DayStats[] {
  if (days.length === 0) return []

  const last = new Date(`${days[days.length - 1].date}T00:00:00.000Z`)
  const first = addDays(last, -(limit - 1))
  const existing = new Map(days.map((day) => [day.date, day]))
  const result: DayStats[] = []

  for (let cursor = first; cursor <= last; cursor = addDays(cursor, 1)) {
    const key = dateKey(cursor.getTime())
    result.push(existing.get(key) || emptyDayStats(key))
  }

  return result
}

export function aggregateAnalytics(data: SyncData): AggregatedStats {
  const {
    session: sessions,
    message: messagesBySession,
    part: partsByMessage,
    todo: todosBySession,
    workspaceList,
    background_job: bgJobsBySession,
  } = data

  // Accumulators
  let totalInput = 0
  let totalOutput = 0
  let totalReasoning = 0
  let totalCacheRead = 0
  let totalCacheWrite = 0
  let totalCost = 0
  let totalMessages = 0
  let archivedSessions = 0

  const sessionStatsMap = new Map<string, SessionStats>()
  const providerMap = new Map<string, ProviderStats>()
  const dayMap = new Map<string, DayStats>()
  const modelMap = new Map<string, ModelStats>()
  const projectMap = new Map<string, ProjectStats>()
  const toolUsageMap = new Map<string, { count: number; success: number; error: number }>()
  const bgRunList: BackgroundJob[] = []

  // Todo accumulators
  let todosTotal = 0
  let todosPending = 0
  let todosInProgress = 0
  let todosCompleted = 0
  let todosCancelled = 0
  const todosByPriority = new Map<string, number>()

  // Workspace accumulators
  let workspacesActive = 0
  let workspacesDisconnected = 0
  const workspacesByType = new Map<string, number>()

  // Process workspaces
  for (const ws of workspaceList) {
    const wsAny = ws as any
    if (wsAny.status === "active" || wsAny.status === "connected") {
      workspacesActive++
    } else {
      workspacesDisconnected++
    }
    const type = wsAny.config?.type ?? "unknown"
    workspacesByType.set(type, (workspacesByType.get(type) ?? 0) + 1)
  }

  // Process todos
  for (const sessionTodos of Object.values(todosBySession)) {
    for (const todo of sessionTodos) {
      todosTotal++
      switch (todo.status) {
        case "pending":
          todosPending++
          break
        case "in_progress":
          todosInProgress++
          break
        case "completed":
          todosCompleted++
          break
        case "cancelled":
          todosCancelled++
          break
      }
      const priority = todo.priority ?? "none"
      todosByPriority.set(priority, (todosByPriority.get(priority) ?? 0) + 1)
    }
  }

  // Process sessions
  for (const session of sessions) {
    const messages = messagesBySession[session.id] ?? []
    const assistantMessages = messages.filter((m) => m.role === "assistant")

    // Check if archived
    if (session.time.archived) archivedSessions++

    let sessionInput = 0
    let sessionOutput = 0
    let sessionReasoning = 0
    let sessionCacheRead = 0
    let sessionCacheWrite = 0
    let sessionCost = 0
    let lastModel = "unknown"
    let lastProvider = "unknown"

    // Process messages for tokens/cost
    for (const msg of assistantMessages) {
      totalMessages++
      if (msg.tokens) {
        sessionInput += msg.tokens.input || 0
        sessionOutput += msg.tokens.output || 0
        sessionReasoning += msg.tokens.reasoning || 0
        sessionCacheRead += msg.tokens.cache?.read || 0
        sessionCacheWrite += msg.tokens.cache?.write || 0
      }
      if (msg.cost) {
        sessionCost += msg.cost
        totalCost += msg.cost
      }
      if (msg.modelID) lastModel = msg.modelID
      if (msg.providerID) lastProvider = msg.providerID
    }

    totalInput += sessionInput
    totalOutput += sessionOutput
    totalReasoning += sessionReasoning
    totalCacheRead += sessionCacheRead
    totalCacheWrite += sessionCacheWrite

    const sessionTokens = sessionInput + sessionOutput + sessionReasoning
    const sessionDateKey = dateKey(session.time.updated)

    // Session stats
    const duration = session.time.updated - session.time.created
    sessionStatsMap.set(session.id, {
      sessionID: session.id,
      title: session.title || session.id.slice(-8),
      directory: session.directory || "default",
      messages: messages.length,
      tokens: {
        input: sessionInput,
        output: sessionOutput,
        reasoning: sessionReasoning,
        cacheRead: sessionCacheRead,
        cacheWrite: sessionCacheWrite,
      },
      cost: sessionCost,
      model: lastModel,
      provider: lastProvider,
      updated: session.time.updated,
      created: session.time.created,
      duration,
    })

    // Project aggregation (by directory)
    const projectID = session.directory || "default"
    const proj = projectMap.get(projectID) || {
      id: projectID,
      name: projectID.split("/").pop() || projectID,
      vcs: "unknown" as const,
      sessionCount: 0,
      workspaceCount: 0,
      totalCost: 0,
      totalTokens: 0,
      created: session.time.created,
      lastActive: session.time.updated,
    }
    proj.sessionCount++
    proj.totalCost += sessionCost
    proj.totalTokens += sessionTokens
    proj.created = Math.min(proj.created, session.time.created)
    proj.lastActive = Math.max(proj.lastActive, session.time.updated)
    if (session.workspaceID) {
      proj.workspaceCount++
    }
    projectMap.set(projectID, proj)

    // Provider stats
    const pKey = lastProvider
    const pStats = providerMap.get(pKey) || {
      providerID: pKey,
      sessions: 0,
      messages: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: 0 },
      cost: 0,
      models: new Set<string>(),
    }
    pStats.sessions++
    pStats.messages += assistantMessages.length
    pStats.tokens.input += sessionInput
    pStats.tokens.output += sessionOutput
    pStats.tokens.reasoning += sessionReasoning
    pStats.tokens.cache += sessionCacheRead + sessionCacheWrite
    pStats.cost += sessionCost
    pStats.models.add(lastModel)
    providerMap.set(pKey, pStats)

    // Day stats
    const sessionDay = getDayStats(dayMap, sessionDateKey)
    sessionDay.sessions++
    dayMap.set(sessionDateKey, sessionDay)

    const sessionModelKeys = new Set<string>()
    for (const msg of assistantMessages) {
      const tokens = msg.tokens
      if (!tokens) continue

      const input = tokens.input || 0
      const output = tokens.output || 0
      const reasoning = tokens.reasoning || 0
      const cacheRead = tokens.cache?.read || 0
      const cacheWrite = tokens.cache?.write || 0
      const total = input + output + reasoning
      const timestamp = msg.time?.completed ?? msg.time?.created ?? session.time.updated
      const msgDateKey = dateKey(timestamp)
      const providerID = msg.providerID || "unknown"
      const modelID = msg.modelID || "unknown"
      const modelKey = `${providerID}/${modelID}`
      const cost = msg.cost || 0

      sessionModelKeys.add(modelKey)

      const modelStats = modelMap.get(modelKey) || {
        key: modelKey,
        providerID,
        modelID,
        sessions: 0,
        messages: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
        cost: 0,
        firstUsed: timestamp,
        lastUsed: timestamp,
      }
      modelStats.messages++
      modelStats.tokens.input += input
      modelStats.tokens.output += output
      modelStats.tokens.reasoning += reasoning
      modelStats.tokens.cacheRead += cacheRead
      modelStats.tokens.cacheWrite += cacheWrite
      modelStats.cost += cost
      modelStats.firstUsed = Math.min(modelStats.firstUsed, timestamp)
      modelStats.lastUsed = Math.max(modelStats.lastUsed, timestamp)
      modelMap.set(modelKey, modelStats)

      const dStats = getDayStats(dayMap, msgDateKey)
      dStats.tokens += total
      dStats.input += input
      dStats.output += output
      dStats.reasoning += reasoning
      dStats.cacheRead += cacheRead
      dStats.cacheWrite += cacheWrite
      dStats.cost += cost
      dStats.messages++

      const existingModelDay = dStats.models.get(modelKey)
      if (existingModelDay) {
        existingModelDay.tokens += total
        existingModelDay.cost += cost
        existingModelDay.messages++
      } else {
        dStats.models.set(modelKey, { modelKey, tokens: total, cost, messages: 1 })
      }
      dayMap.set(msgDateKey, dStats)
    }

    for (const modelKey of sessionModelKeys) {
      const modelStats = modelMap.get(modelKey)
      if (modelStats) modelStats.sessions++
    }

    // Process message parts for tool usage
    for (const msg of assistantMessages) {
      const parts = partsByMessage[msg.id] ?? []
      for (const part of parts) {
        if (part.type === "tool" && part.tool) {
          const toolName = part.tool
          const toolStats = toolUsageMap.get(toolName) || { count: 0, success: 0, error: 0 }
          toolStats.count++
          // Check state for success/error
          if (part.state && typeof part.state === "object") {
            const stateObj = part.state as { status?: string }
            if (stateObj.status === "success" || stateObj.status === "complete") {
              toolStats.success++
            } else if (stateObj.status === "error" || stateObj.status === "failed") {
              toolStats.error++
            }
          }
          toolUsageMap.set(toolName, toolStats)
        }
      }
    }

    // Collect background jobs
    const sessionJobs = bgJobsBySession[session.id] ?? []
    bgRunList.push(...sessionJobs)
  }

  // Process background runs
  let bgRunning = 0
  let bgCompleted = 0
  let bgError = 0
  let bgCancelled = 0
  let bgTotalDuration = 0
  const bgAgentCounts = new Map<string, number>()

  for (const job of bgRunList) {
    switch (job.status) {
      case "running":
      case "synthesizing":
        bgRunning++
        break
      case "complete":
        bgCompleted++
        break
      case "error":
      case "orphaned":
        bgError++
        break
      case "cancelled":
      case "timeout":
        bgCancelled++
        break
    }

    if (job.completedAt && job.createdAt) {
      bgTotalDuration += job.completedAt - job.createdAt
    }

    if (job.agent) {
      bgAgentCounts.set(job.agent, (bgAgentCounts.get(job.agent) ?? 0) + 1)
    }
  }

  const bgTotal = bgRunList.length
  const bgSuccessRate = bgTotal > 0 ? (bgCompleted / bgTotal) * 100 : 0
  const bgAvgDuration = bgCompleted > 0 ? bgTotalDuration / bgCompleted : 0

  const bgTopAgents = Array.from(bgAgentCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([agent, count]) => ({ agent, count }))

  // Tool usage aggregation
  const toolUsageTotal = Array.from(toolUsageMap.values()).reduce((sum, t) => sum + t.count, 0)
  const toolUsageList = Array.from(toolUsageMap.entries())
    .map(([name, stats]) => ({
      name,
      count: stats.count,
      successRate: stats.count > 0 ? (stats.success / stats.count) * 100 : 0,
    }))
    .sort((a, b) => b.count - a.count)

  const mostUsedTools = toolUsageList.slice(0, 10)

  // Calculate totals
  const totalNonCacheTokens = totalInput + totalOutput + totalReasoning
  const totalAllTokens = totalNonCacheTokens + totalCacheRead + totalCacheWrite
  const costPer1kTokens = totalNonCacheTokens > 0 ? (totalCost / totalNonCacheTokens) * 1000 : 0
  const costPerSession = sessions.length > 0 ? totalCost / sessions.length : 0
  const avgTokensPerSession = sessions.length > 0 ? totalNonCacheTokens / sessions.length : 0

  // Day stats sorted, last 30 days
  const sortedDays = fillDailyRange(
    Array.from(dayMap.values()).sort((a, b) => a.date.localeCompare(b.date)),
    30,
  )

  const avgCostPerDay = sortedDays.length > 0 ? sortedDays.reduce((sum, d) => sum + d.cost, 0) / sortedDays.length : 0

  // Sessions sorted by tokens
  const sortedSessions = Array.from(sessionStatsMap.values()).sort((a, b) => {
    const aTokens = a.tokens.input + a.tokens.output + a.tokens.reasoning
    const bTokens = b.tokens.input + b.tokens.output + b.tokens.reasoning
    return bTokens - aTokens
  })

  // Projects sorted by last activity
  const sortedProjects = Array.from(projectMap.values()).sort((a, b) => b.lastActive - a.lastActive)
  const sortedModels = Array.from(modelMap.values()).sort((a, b) => {
    const aTokens = a.tokens.input + a.tokens.output + a.tokens.reasoning
    const bTokens = b.tokens.input + b.tokens.output + b.tokens.reasoning
    return bTokens - aTokens
  })

  return {
    global: {
      sessions: sessions.length,
      archivedSessions,
      messages: totalMessages,
      tokens: {
        input: totalInput,
        output: totalOutput,
        reasoning: totalReasoning,
        cacheRead: totalCacheRead,
        cacheWrite: totalCacheWrite,
      },
      cost: totalCost,
      projects: sortedProjects,
      workspaces: {
        total: workspaceList.length,
        active: workspacesActive,
        disconnected: workspacesDisconnected,
        byType: Object.fromEntries(workspacesByType),
      },
      backgroundRuns: {
        total: bgTotal,
        running: bgRunning,
        completed: bgCompleted,
        error: bgError,
        cancelled: bgCancelled,
        successRate: bgSuccessRate,
        avgDuration: bgAvgDuration,
        topAgents: bgTopAgents,
      },
      toolUsage: {
        total: toolUsageTotal,
        tools: toolUsageList,
        mostUsed: mostUsedTools,
      },
      todos: {
        total: todosTotal,
        pending: todosPending,
        inProgress: todosInProgress,
        completed: todosCompleted,
        cancelled: todosCancelled,
        completionRate: todosTotal > 0 ? (todosCompleted / todosTotal) * 100 : 0,
        byPriority: Array.from(todosByPriority.entries())
          .map(([priority, count]) => ({ priority, count }))
          .sort((a, b) => b.count - a.count),
      },
      efficiency: {
        costPer1kTokens,
        costPerSession,
        avgTokensPerSession,
        avgCostPerDay,
      },
    },
    projects: sortedProjects,
    workspaces: {
      total: workspaceList.length,
      active: workspacesActive,
      disconnected: workspacesDisconnected,
      byType: Object.fromEntries(workspacesByType),
    },
    sessions: sortedSessions,
    providers: providerMap,
    models: sortedModels,
    days: sortedDays,
    backgroundRuns: {
      total: bgTotal,
      running: bgRunning,
      completed: bgCompleted,
      error: bgError,
      cancelled: bgCancelled,
      successRate: bgSuccessRate,
      avgDuration: bgAvgDuration,
      topAgents: bgTopAgents,
    },
    toolUsage: {
      total: toolUsageTotal,
      tools: toolUsageList,
      mostUsed: mostUsedTools,
    },
    todos: {
      total: todosTotal,
      pending: todosPending,
      inProgress: todosInProgress,
      completed: todosCompleted,
      cancelled: todosCancelled,
      completionRate: todosTotal > 0 ? (todosCompleted / todosTotal) * 100 : 0,
      byPriority: Array.from(todosByPriority.entries())
        .map(([priority, count]) => ({ priority, count }))
        .sort((a, b) => b.count - a.count),
    },
  }
}

// ===== Historical Data Merge =====

export interface HistoricalGlobalData {
  version: number
  updatedAt: number
  totals: {
    sessions: number
    messages: number
    tokens: { input: number; output: number; reasoning: number; cacheRead: number; cacheWrite: number }
    cost: number
    toolCalls: number
  }
  byProvider: Record<string, { sessions: number; messages: number; tokens: number; cost: number }>
  byModel: Record<
    string,
    {
      sessions: number
      messages: number
      tokens: { input: number; output: number; reasoning: number }
      cost: number
      firstUsed: number
      lastUsed: number
    }
  >
  byProject: Record<string, { sessions: number; tokens: number; cost: number; lastActive: number }>
}

export interface HistoricalDailyData {
  date: string
  sessions: number
  messages: number
  tokens: { input: number; output: number; reasoning: number; cacheRead: number; cacheWrite: number }
  cost: number
  toolCalls: number
  tools: Record<string, { calls: number; success: number; error: number }>
  providers: Record<string, { messages: number; tokens: number; cost: number }>
  models: Record<string, { messages: number; tokens: number; cost: number }>
  recordedAt: number
}

function historicalDailyToDayStats(hd: HistoricalDailyData): DayStats {
  return {
    date: hd.date,
    sessions: hd.sessions,
    tokens: hd.tokens.input + hd.tokens.output + hd.tokens.reasoning,
    input: hd.tokens.input,
    output: hd.tokens.output,
    reasoning: hd.tokens.reasoning,
    cacheRead: hd.tokens.cacheRead,
    cacheWrite: hd.tokens.cacheWrite,
    cost: hd.cost,
    messages: hd.messages,
    models: new Map(
      Object.entries(hd.models).map(([modelKey, stats]) => [
        modelKey,
        { modelKey, tokens: stats.tokens, cost: stats.cost, messages: stats.messages },
      ]),
    ),
  }
}

function mergeDayModelRows(a: DayStats["models"], b: DayStats["models"]): DayStats["models"] {
  const m = new Map<string, { modelKey: string; tokens: number; cost: number; messages: number }>()
  for (const [key, row] of a) {
    m.set(key, { ...row })
  }
  for (const [key, row] of b) {
    const ex = m.get(key)
    if (!ex) m.set(key, { ...row })
    else {
      ex.tokens = Math.max(ex.tokens, row.tokens)
      ex.cost = Math.max(ex.cost, row.cost)
      ex.messages = Math.max(ex.messages, row.messages)
    }
  }
  return m
}

/** When a date exists in both TUI (subset of messages loaded) and storage, take per-metric max. */
function mergeOverlappingDayStats(hist: DayStats, live: DayStats): DayStats {
  return {
    date: live.date,
    sessions: Math.max(hist.sessions, live.sessions),
    tokens: Math.max(hist.tokens, live.tokens),
    input: Math.max(hist.input, live.input),
    output: Math.max(hist.output, live.output),
    reasoning: Math.max(hist.reasoning, live.reasoning),
    cacheRead: Math.max(hist.cacheRead, live.cacheRead),
    cacheWrite: Math.max(hist.cacheWrite, live.cacheWrite),
    cost: Math.max(hist.cost, live.cost),
    messages: Math.max(hist.messages, live.messages),
    models: mergeDayModelRows(hist.models, live.models),
  }
}

/**
 * Merge live sync data with historical persistent data.
 * Uses live data for recent, historical for older; overlapping dates use max(...) so TUI
 * partial message loads never replace full daily totals from storage.
 */
export function mergeWithHistorical(
  live: AggregatedStats,
  historical: {
    global: HistoricalGlobalData
    daily: HistoricalDailyData[]
  },
): AggregatedStats {
  const mergedDayMap = new Map<string, DayStats>()

  for (const hd of historical.daily) {
    mergedDayMap.set(hd.date, historicalDailyToDayStats(hd))
  }

  for (const ld of live.days) {
    const prev = mergedDayMap.get(ld.date)
    if (!prev) mergedDayMap.set(ld.date, ld)
    else mergedDayMap.set(ld.date, mergeOverlappingDayStats(prev, ld))
  }

  // Sort merged days
  const mergedDays = Array.from(mergedDayMap.values()).sort((a, b) => a.date.localeCompare(b.date))

  // Use historical global totals as the baseline, but prefer live totals
  // if they're higher (to avoid going backwards during a session)
  const mergedNonCache =
    Math.max(live.global.tokens.input, historical.global.totals.tokens.input) +
    Math.max(live.global.tokens.output, historical.global.totals.tokens.output) +
    Math.max(live.global.tokens.reasoning, historical.global.totals.tokens.reasoning)
  const mergedSessions = Math.max(live.global.sessions, historical.global.totals.sessions)
  const mergedMessages = Math.max(live.global.messages, historical.global.totals.messages)
  const mergedCost = Math.max(live.global.cost, historical.global.totals.cost)
  const dayWindow = mergedDays.slice(-30)
  const mergedAvgCostPerDay =
    dayWindow.length > 0 ? dayWindow.reduce((sum, d) => sum + d.cost, 0) / dayWindow.length : 0

  const mergedGlobal: GlobalStats = {
    ...live.global,
    sessions: mergedSessions,
    messages: mergedMessages,
    tokens: {
      input: Math.max(live.global.tokens.input, historical.global.totals.tokens.input),
      output: Math.max(live.global.tokens.output, historical.global.totals.tokens.output),
      reasoning: Math.max(live.global.tokens.reasoning, historical.global.totals.tokens.reasoning),
      cacheRead: Math.max(live.global.tokens.cacheRead, historical.global.totals.tokens.cacheRead),
      cacheWrite: Math.max(live.global.tokens.cacheWrite, historical.global.totals.tokens.cacheWrite),
    },
    cost: mergedCost,
    efficiency: {
      costPer1kTokens: mergedNonCache > 0 ? (mergedCost / mergedNonCache) * 1000 : 0,
      costPerSession: mergedSessions > 0 ? mergedCost / mergedSessions : 0,
      avgTokensPerSession: mergedSessions > 0 ? mergedNonCache / mergedSessions : 0,
      avgCostPerDay: mergedAvgCostPerDay,
    },
  }

  // Merge model data from historical
  const mergedModels = new Map<string, ModelStats>()
  for (const model of live.models) {
    mergedModels.set(model.key, model)
  }
  for (const [key, hModel] of Object.entries(historical.global.byModel)) {
    const existing = mergedModels.get(key)
    if (existing) {
      existing.sessions = Math.max(existing.sessions, hModel.sessions)
      existing.messages = Math.max(existing.messages, hModel.messages)
      existing.tokens.input = Math.max(existing.tokens.input, hModel.tokens.input)
      existing.tokens.output = Math.max(existing.tokens.output, hModel.tokens.output)
      existing.tokens.reasoning = Math.max(existing.tokens.reasoning, hModel.tokens.reasoning)
      existing.cost = Math.max(existing.cost, hModel.cost)
      existing.firstUsed = Math.min(existing.firstUsed, hModel.firstUsed)
      existing.lastUsed = Math.max(existing.lastUsed, hModel.lastUsed)
      existing.tokens.cacheRead = existing.tokens.cacheRead || 0
      existing.tokens.cacheWrite = existing.tokens.cacheWrite || 0
    } else {
      mergedModels.set(key, {
        key,
        providerID: key.split("/")[0] ?? "unknown",
        modelID: key.split("/").slice(1).join("/") || "unknown",
        sessions: hModel.sessions,
        messages: hModel.messages,
        tokens: {
          input: hModel.tokens.input,
          output: hModel.tokens.output,
          reasoning: hModel.tokens.reasoning,
          cacheRead: 0,
          cacheWrite: 0,
        },
        cost: hModel.cost,
        firstUsed: hModel.firstUsed,
        lastUsed: hModel.lastUsed,
      })
    }
  }

  // Merge provider data from historical
  const mergedProviders = new Map(live.providers)
  for (const [key, hProv] of Object.entries(historical.global.byProvider)) {
    const existing = mergedProviders.get(key)
    if (!existing) {
      mergedProviders.set(key, {
        providerID: key,
        sessions: hProv.sessions,
        messages: hProv.messages,
        tokens: { input: 0, output: 0, reasoning: 0, cache: hProv.tokens },
        cost: hProv.cost,
        models: new Set(),
      })
    } else {
      existing.sessions = Math.max(existing.sessions, hProv.sessions)
      existing.messages = Math.max(existing.messages, hProv.messages)
      existing.cost = Math.max(existing.cost, hProv.cost)
      const liveTokenSum =
        existing.tokens.input + existing.tokens.output + existing.tokens.reasoning + existing.tokens.cache
      if (hProv.tokens > liveTokenSum) {
        existing.tokens.cache += hProv.tokens - liveTokenSum
      }
    }
  }

  return {
    ...live,
    global: mergedGlobal,
    models: Array.from(mergedModels.values()).sort((a, b) => {
      const aTokens = a.tokens.input + a.tokens.output + a.tokens.reasoning
      const bTokens = b.tokens.input + b.tokens.output + b.tokens.reasoning
      return bTokens - aTokens
    }),
    providers: mergedProviders,
    days: mergedDays,
  }
}

/**
 * When daily snapshots are missing or sparse, rebuild per-day (and global floor) totals from
 * persisted session rows (`GET /analytics/sessions`). Merges with existing `stats.days` via max.
 */
export function augmentAggregatedStatsFromPersistedSessions(
  stats: AggregatedStats,
  sessions: SessionAnalytics[],
): AggregatedStats {
  if (sessions.length === 0) return stats

  const sessionDays = new Map<string, DayStats>()
  const modelAgg = new Map<string, ModelStats>()
  type ProvAgg = {
    sessions: number
    messages: number
    input: number
    output: number
    reasoning: number
    cache: number
    cost: number
    models: Set<string>
  }
  const provAgg = new Map<string, ProvAgg>()
  const projAgg = new Map<string, ProjectStats>()

  let sumMessages = 0
  let sumCost = 0
  let sumIn = 0
  let sumOut = 0
  let sumRe = 0
  let sumCr = 0
  let sumCw = 0
  let sumToolCalls = 0

  for (const s of sessions) {
    sumMessages += s.messages
    sumCost += s.cost
    sumIn += s.tokens.input
    sumOut += s.tokens.output
    sumRe += s.tokens.reasoning
    sumCr += s.tokens.cacheRead
    sumCw += s.tokens.cacheWrite
    sumToolCalls += s.toolCalls ?? 0

    const mk = `${s.providerID}/${s.modelID}`
    const ts = s.time.completed || s.time.created
    const mPrev = modelAgg.get(mk)
    if (!mPrev) {
      modelAgg.set(mk, {
        key: mk,
        providerID: s.providerID || "unknown",
        modelID: s.modelID || "unknown",
        sessions: 1,
        messages: s.messages,
        tokens: {
          input: s.tokens.input,
          output: s.tokens.output,
          reasoning: s.tokens.reasoning,
          cacheRead: s.tokens.cacheRead,
          cacheWrite: s.tokens.cacheWrite,
        },
        cost: s.cost,
        firstUsed: ts,
        lastUsed: ts,
      })
    } else {
      mPrev.sessions++
      mPrev.messages += s.messages
      mPrev.tokens.input += s.tokens.input
      mPrev.tokens.output += s.tokens.output
      mPrev.tokens.reasoning += s.tokens.reasoning
      mPrev.tokens.cacheRead += s.tokens.cacheRead
      mPrev.tokens.cacheWrite += s.tokens.cacheWrite
      mPrev.cost += s.cost
      mPrev.firstUsed = Math.min(mPrev.firstUsed, ts)
      mPrev.lastUsed = Math.max(mPrev.lastUsed, ts)
    }

    const pk = s.providerID || "unknown"
    const cacheAdd = s.tokens.cacheRead + s.tokens.cacheWrite
    const pPrev = provAgg.get(pk)
    if (!pPrev) {
      provAgg.set(pk, {
        sessions: 1,
        messages: s.messages,
        input: s.tokens.input,
        output: s.tokens.output,
        reasoning: s.tokens.reasoning,
        cache: cacheAdd,
        cost: s.cost,
        models: new Set(s.modelID ? [s.modelID] : []),
      })
    } else {
      pPrev.sessions++
      pPrev.messages += s.messages
      pPrev.input += s.tokens.input
      pPrev.output += s.tokens.output
      pPrev.reasoning += s.tokens.reasoning
      pPrev.cache += cacheAdd
      pPrev.cost += s.cost
      if (s.modelID) pPrev.models.add(s.modelID)
    }

    const projKey = s.projectID || s.directory || "default"
    const projName = (s.directory || s.projectID || "default").split("/").pop() || projKey
    const prPrev = projAgg.get(projKey)
    if (!prPrev) {
      projAgg.set(projKey, {
        id: projKey,
        name: projName,
        vcs: "unknown",
        sessionCount: 1,
        workspaceCount: 0,
        totalCost: s.cost,
        totalTokens: s.tokens.input + s.tokens.output + s.tokens.reasoning,
        created: ts,
        lastActive: ts,
      })
    } else {
      prPrev.sessionCount++
      prPrev.totalCost += s.cost
      prPrev.totalTokens += s.tokens.input + s.tokens.output + s.tokens.reasoning
      prPrev.created = Math.min(prPrev.created, ts)
      prPrev.lastActive = Math.max(prPrev.lastActive, ts)
    }

    const dayDate = dateKey(ts)
    const cur = sessionDays.get(dayDate) || emptyDayStats(dayDate)
    cur.sessions++
    cur.messages += s.messages
    cur.input += s.tokens.input
    cur.output += s.tokens.output
    cur.reasoning += s.tokens.reasoning
    cur.cacheRead += s.tokens.cacheRead
    cur.cacheWrite += s.tokens.cacheWrite
    cur.cost += s.cost
    cur.tokens = cur.input + cur.output + cur.reasoning
    const dayModelKey = mk
    const t = s.tokens.input + s.tokens.output + s.tokens.reasoning
    const prevModel = cur.models.get(dayModelKey)
    if (prevModel) {
      prevModel.tokens += t
      prevModel.cost += s.cost
      prevModel.messages += s.messages
    } else {
      cur.models.set(dayModelKey, { modelKey: dayModelKey, tokens: t, cost: s.cost, messages: s.messages })
    }
    sessionDays.set(dayDate, cur)
  }

  const dayMap = new Map<string, DayStats>()
  for (const d of stats.days) {
    dayMap.set(d.date, {
      ...d,
      models: new Map(Array.from(d.models, ([k, v]) => [k, { ...v }])),
    })
  }
  for (const [date, sd] of sessionDays) {
    const ex = dayMap.get(date)
    if (!ex) {
      dayMap.set(date, { ...sd, models: new Map(Array.from(sd.models, ([k, v]) => [k, { ...v }])) })
    } else {
      dayMap.set(date, mergeOverlappingDayStats(ex, sd))
    }
  }

  const sortedDays = Array.from(dayMap.values()).sort((a, b) => a.date.localeCompare(b.date))
  const filledDays = fillDailyRange(sortedDays.length > 0 ? sortedDays : stats.days, 90)

  const mergedModelsMap = new Map<string, ModelStats>(
    stats.models.map((m) => [m.key, { ...m, tokens: { ...m.tokens } }]),
  )
  for (const [k, agg] of modelAgg) {
    const ex = mergedModelsMap.get(k)
    if (!ex) {
      mergedModelsMap.set(k, { ...agg, tokens: { ...agg.tokens } })
    } else {
      ex.sessions = Math.max(ex.sessions, agg.sessions)
      ex.messages = Math.max(ex.messages, agg.messages)
      ex.tokens.input = Math.max(ex.tokens.input, agg.tokens.input)
      ex.tokens.output = Math.max(ex.tokens.output, agg.tokens.output)
      ex.tokens.reasoning = Math.max(ex.tokens.reasoning, agg.tokens.reasoning)
      ex.tokens.cacheRead = Math.max(ex.tokens.cacheRead, agg.tokens.cacheRead)
      ex.tokens.cacheWrite = Math.max(ex.tokens.cacheWrite, agg.tokens.cacheWrite)
      ex.cost = Math.max(ex.cost, agg.cost)
      ex.firstUsed = Math.min(ex.firstUsed, agg.firstUsed)
      ex.lastUsed = Math.max(ex.lastUsed, agg.lastUsed)
    }
  }
  const mergedModels = Array.from(mergedModelsMap.values()).sort((a, b) => {
    const at = a.tokens.input + a.tokens.output + a.tokens.reasoning
    const bt = b.tokens.input + b.tokens.output + b.tokens.reasoning
    return bt - at
  })

  const mergedProviders = new Map(stats.providers)
  for (const [pid, agg] of provAgg) {
    const ex = mergedProviders.get(pid)
    if (!ex) {
      mergedProviders.set(pid, {
        providerID: pid,
        sessions: agg.sessions,
        messages: agg.messages,
        tokens: {
          input: agg.input,
          output: agg.output,
          reasoning: agg.reasoning,
          cache: agg.cache,
        },
        cost: agg.cost,
        models: new Set(agg.models),
      })
    } else {
      ex.sessions = Math.max(ex.sessions, agg.sessions)
      ex.messages = Math.max(ex.messages, agg.messages)
      ex.cost = Math.max(ex.cost, agg.cost)
      ex.tokens.input = Math.max(ex.tokens.input, agg.input)
      ex.tokens.output = Math.max(ex.tokens.output, agg.output)
      ex.tokens.reasoning = Math.max(ex.tokens.reasoning, agg.reasoning)
      const liveCache = ex.tokens.cache
      const sumCache = agg.cache
      ex.tokens.cache = Math.max(liveCache, sumCache)
      for (const mid of agg.models) ex.models.add(mid)
    }
  }

  const mergedProjectsMap = new Map(stats.projects.map((p) => [p.id, { ...p }]))
  for (const [id, agg] of projAgg) {
    const ex = mergedProjectsMap.get(id)
    if (!ex) {
      mergedProjectsMap.set(id, { ...agg })
    } else {
      ex.sessionCount = Math.max(ex.sessionCount, agg.sessionCount)
      ex.totalTokens = Math.max(ex.totalTokens, agg.totalTokens)
      ex.totalCost = Math.max(ex.totalCost, agg.totalCost)
      ex.created = Math.min(ex.created, agg.created)
      ex.lastActive = Math.max(ex.lastActive, agg.lastActive)
    }
  }
  const mergedProjects = Array.from(mergedProjectsMap.values()).sort((a, b) => b.lastActive - a.lastActive)

  const mergedToolTotal = Math.max(stats.toolUsage.total, sumToolCalls)
  const mergedToolUsage =
    stats.toolUsage.mostUsed.length > 0
      ? { ...stats.toolUsage, total: mergedToolTotal }
      : mergedToolTotal > 0
        ? {
            total: mergedToolTotal,
            tools: [{ name: "all sessions (stored)", count: mergedToolTotal, successRate: 100 }],
            mostUsed: [{ name: "all sessions (stored)", count: mergedToolTotal, successRate: 100 }],
          }
        : { ...stats.toolUsage, total: mergedToolTotal }

  const g = stats.global
  const mergedMessages = Math.max(g.messages, sumMessages)
  const mergedCost = Math.max(g.cost, sumCost)
  const mergedTokens = {
    input: Math.max(g.tokens.input, sumIn),
    output: Math.max(g.tokens.output, sumOut),
    reasoning: Math.max(g.tokens.reasoning, sumRe),
    cacheRead: Math.max(g.tokens.cacheRead, sumCr),
    cacheWrite: Math.max(g.tokens.cacheWrite, sumCw),
  }
  const mergedSessions = Math.max(g.sessions, sessions.length)
  const nonCache = mergedTokens.input + mergedTokens.output + mergedTokens.reasoning
  const dayWin = filledDays.slice(-30)
  const avgCostPerDay =
    dayWin.length > 0 ? dayWin.reduce((sum, d) => sum + d.cost, 0) / dayWin.length : g.efficiency.avgCostPerDay

  return {
    ...stats,
    models: mergedModels,
    providers: mergedProviders,
    projects: mergedProjects,
    toolUsage: mergedToolUsage,
    global: {
      ...g,
      sessions: mergedSessions,
      messages: mergedMessages,
      tokens: mergedTokens,
      cost: mergedCost,
      projects: mergedProjects,
      toolUsage: mergedToolUsage,
      efficiency: {
        costPer1kTokens: nonCache > 0 ? (mergedCost / nonCache) * 1000 : 0,
        costPerSession: mergedSessions > 0 ? mergedCost / mergedSessions : 0,
        avgTokensPerSession: mergedSessions > 0 ? nonCache / mergedSessions : 0,
        avgCostPerDay,
      },
    },
    days: filledDays.length > 0 ? filledDays : stats.days,
  }
}
