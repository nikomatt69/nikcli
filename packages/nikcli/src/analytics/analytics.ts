import z from "zod"
import { Database } from "@/database/database"
import { Log } from "../util/log"

const log = Log.create({ service: "analytics" })

export const TokenBreakdown = z.object({
  input: z.number(),
  output: z.number(),
  reasoning: z.number(),
  cacheRead: z.number(),
  cacheWrite: z.number(),
})
export type TokenBreakdown = z.infer<typeof TokenBreakdown>

export const GlobalAnalytics = z.object({
  version: z.literal(1),
  updatedAt: z.number(),
  totals: z.object({
    sessions: z.number(),
    messages: z.number(),
    tokens: TokenBreakdown,
    cost: z.number(),
    toolCalls: z.number(),
  }),
  byProvider: z.record(
    z.string(),
    z.object({
      sessions: z.number(),
      messages: z.number(),
      tokens: z.number(),
      cost: z.number(),
    }),
  ),
  byModel: z.record(
    z.string(),
    z.object({
      sessions: z.number(),
      messages: z.number(),
      tokens: z.object({
        input: z.number(),
        output: z.number(),
        reasoning: z.number(),
      }),
      cost: z.number(),
      firstUsed: z.number(),
      lastUsed: z.number(),
    }),
  ),
  byProject: z.record(
    z.string(),
    z.object({
      sessions: z.number(),
      tokens: z.number(),
      cost: z.number(),
      lastActive: z.number(),
    }),
  ),
})
export type GlobalAnalytics = z.infer<typeof GlobalAnalytics>

export const DailyAnalytics = z.object({
  date: z.string(),
  sessions: z.number(),
  messages: z.number(),
  tokens: TokenBreakdown,
  cost: z.number(),
  toolCalls: z.number(),
  tools: z.record(
    z.string(),
    z.object({
      calls: z.number(),
      success: z.number(),
      error: z.number(),
    }),
  ),
  providers: z.record(
    z.string(),
    z.object({
      messages: z.number(),
      tokens: z.number(),
      cost: z.number(),
    }),
  ),
  models: z.record(
    z.string(),
    z.object({
      messages: z.number(),
      tokens: z.number(),
      cost: z.number(),
    }),
  ),
  recordedAt: z.number(),
})
export type DailyAnalytics = z.infer<typeof DailyAnalytics>

export const SessionAnalytics = z.object({
  sessionID: z.string(),
  projectID: z.string(),
  directory: z.string(),
  title: z.string(),
  providerID: z.string(),
  modelID: z.string(),
  messages: z.number(),
  tokens: TokenBreakdown,
  cost: z.number(),
  toolCalls: z.number(),
  duration: z.number(),
  time: z.object({
    created: z.number(),
    completed: z.number(),
  }),
})
export type SessionAnalytics = z.infer<typeof SessionAnalytics>

function emptyGlobal(): GlobalAnalytics {
  return {
    version: 1,
    updatedAt: Date.now(),
    totals: {
      sessions: 0,
      messages: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
      cost: 0,
      toolCalls: 0,
    },
    byProvider: {},
    byModel: {},
    byProject: {},
  }
}

const HAS_MODEL = `
  role = 'assistant'
  AND json_extract(info, '$.providerID') IS NOT NULL
  AND json_extract(info, '$.providerID') != ''
  AND json_extract(info, '$.modelID') IS NOT NULL
  AND json_extract(info, '$.modelID') != ''`

const DAY_OF = "date(created_at / 1000, 'unixepoch')"
const token = (field: string) => `COALESCE(SUM(COALESCE(json_extract(info, '$.tokens.${field}'), 0)), 0)`

function native() {
  return Database.syncNative()
}

function num(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

export namespace Analytics {
  /**
   * Recording is a no-op. Totals are queried from `message_info` /
   * `session_info` / `message_part`. The signatures stay so session writes
   * do not have to know the JSON snapshots are gone.
   */
  export async function recordMessage(_data: {
    sessionID: string
    projectID: string
    directory: string
    providerID: string
    modelID: string
    tokens: {
      input: number
      output: number
      reasoning: number
      cache: { read: number; write: number }
    }
    cost: number
    timestamp: number
  }): Promise<void> {}

  export async function recordSession(_data: {
    sessionID: string
    projectID: string
    directory: string
    timestamp: number
  }): Promise<void> {}

  export async function recordToolUse(_data: {
    toolName: string
    sessionID: string
    success: boolean
    timestamp: number
  }): Promise<void> {}

  export async function recordSessionEnd(_data: {
    sessionID: string
    projectID: string
    directory: string
    title: string
    providerID: string
    modelID: string
    messages: number
    tokens: {
      input: number
      output: number
      reasoning: number
      cacheRead: number
      cacheWrite: number
    }
    cost: number
    toolCalls: number
    duration: number
    created: number
    completed: number
  }): Promise<void> {}

  /** @deprecated Snapshots are derived; nothing to backfill. */
  export async function backfillFromExisting(): Promise<void> {}

  export async function getGlobal(): Promise<GlobalAnalytics> {
    try {
      const db = native()
      const totals = db
        .query<
          {
            sessions: number
            messages: number
            input: number
            output: number
            reasoning: number
            cacheRead: number
            cacheWrite: number
            cost: number
            toolCalls: number
          },
          []
        >(
          `SELECT
             (SELECT COUNT(*) FROM session_info) AS sessions,
             COUNT(*) AS messages,
             ${token("input")} AS input,
             ${token("output")} AS output,
             ${token("reasoning")} AS reasoning,
             ${token("cache.read")} AS cacheRead,
             ${token("cache.write")} AS cacheWrite,
             COALESCE(SUM(COALESCE(json_extract(info, '$.cost'), 0)), 0) AS cost,
             (SELECT COUNT(*) FROM message_part WHERE type = 'tool') AS toolCalls
           FROM message_info
           WHERE ${HAS_MODEL}`,
        )
        .get()

      const byProvider: GlobalAnalytics["byProvider"] = {}
      for (const row of db
        .query<{ provider: string; sessions: number; messages: number; tokens: number; cost: number }, []>(
          `SELECT
             json_extract(info, '$.providerID') AS provider,
             COUNT(DISTINCT session_id) AS sessions,
             COUNT(*) AS messages,
             ${token("input")} + ${token("output")} + ${token("reasoning")} AS tokens,
             COALESCE(SUM(COALESCE(json_extract(info, '$.cost'), 0)), 0) AS cost
           FROM message_info
           WHERE ${HAS_MODEL}
           GROUP BY 1`,
        )
        .all()) {
        if (!row.provider) continue
        byProvider[row.provider] = {
          sessions: num(row.sessions),
          messages: num(row.messages),
          tokens: num(row.tokens),
          cost: num(row.cost),
        }
      }

      const byModel: GlobalAnalytics["byModel"] = {}
      for (const row of db
        .query<
          {
            provider: string
            model: string
            sessions: number
            messages: number
            input: number
            output: number
            reasoning: number
            cost: number
            firstUsed: number
            lastUsed: number
          },
          []
        >(
          `SELECT
             json_extract(info, '$.providerID') AS provider,
             json_extract(info, '$.modelID') AS model,
             COUNT(DISTINCT session_id) AS sessions,
             COUNT(*) AS messages,
             ${token("input")} AS input,
             ${token("output")} AS output,
             ${token("reasoning")} AS reasoning,
             COALESCE(SUM(COALESCE(json_extract(info, '$.cost'), 0)), 0) AS cost,
             MIN(created_at) AS firstUsed,
             MAX(COALESCE(json_extract(info, '$.time.completed'), created_at)) AS lastUsed
           FROM message_info
           WHERE ${HAS_MODEL}
           GROUP BY 1, 2`,
        )
        .all()) {
        if (!row.provider || !row.model) continue
        byModel[`${row.provider}/${row.model}`] = {
          sessions: num(row.sessions),
          messages: num(row.messages),
          tokens: { input: num(row.input), output: num(row.output), reasoning: num(row.reasoning) },
          cost: num(row.cost),
          firstUsed: num(row.firstUsed),
          lastUsed: num(row.lastUsed),
        }
      }

      const byProject: GlobalAnalytics["byProject"] = {}
      for (const row of db
        .query<{ projectID: string; sessions: number; tokens: number; cost: number; lastActive: number }, []>(
          `SELECT
             s.project_id AS projectID,
             COUNT(DISTINCT s.id) AS sessions,
             COALESCE(SUM(
               CASE WHEN m.role = 'assistant'
                 THEN COALESCE(json_extract(m.info, '$.tokens.input'), 0)
                    + COALESCE(json_extract(m.info, '$.tokens.output'), 0)
                    + COALESCE(json_extract(m.info, '$.tokens.reasoning'), 0)
               ELSE 0 END
             ), 0) AS tokens,
             COALESCE(SUM(
               CASE WHEN m.role = 'assistant' THEN COALESCE(json_extract(m.info, '$.cost'), 0) ELSE 0 END
             ), 0) AS cost,
             MAX(s.updated_at) AS lastActive
           FROM session_info s
           LEFT JOIN message_info m ON m.session_id = s.id
           GROUP BY s.project_id`,
        )
        .all()) {
        if (!row.projectID) continue
        byProject[row.projectID] = {
          sessions: num(row.sessions),
          tokens: num(row.tokens),
          cost: num(row.cost),
          lastActive: num(row.lastActive),
        }
      }

      return {
        version: 1,
        updatedAt: Date.now(),
        totals: {
          sessions: num(totals?.sessions),
          messages: num(totals?.messages),
          tokens: {
            input: num(totals?.input),
            output: num(totals?.output),
            reasoning: num(totals?.reasoning),
            cacheRead: num(totals?.cacheRead),
            cacheWrite: num(totals?.cacheWrite),
          },
          cost: num(totals?.cost),
          toolCalls: num(totals?.toolCalls),
        },
        byProvider,
        byModel,
        byProject,
      }
    } catch (error) {
      log.error("Failed to read global analytics", { error })
      return emptyGlobal()
    }
  }

  export async function getDaily(from: string, to: string): Promise<DailyAnalytics[]> {
    try {
      const db = native()
      const days = new Map<string, DailyAnalytics>()

      const ensure = (date: string): DailyAnalytics => {
        const existing = days.get(date)
        if (existing) return existing
        const fresh: DailyAnalytics = {
          date,
          sessions: 0,
          messages: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
          cost: 0,
          toolCalls: 0,
          tools: {},
          providers: {},
          models: {},
          recordedAt: Date.now(),
        }
        days.set(date, fresh)
        return fresh
      }

      for (const row of db
        .query<
          {
            date: string
            sessions: number
            messages: number
            input: number
            output: number
            reasoning: number
            cacheRead: number
            cacheWrite: number
            cost: number
          },
          [string, string]
        >(
          `SELECT
             ${DAY_OF} AS date,
             COUNT(DISTINCT session_id) AS sessions,
             COUNT(*) AS messages,
             ${token("input")} AS input,
             ${token("output")} AS output,
             ${token("reasoning")} AS reasoning,
             ${token("cache.read")} AS cacheRead,
             ${token("cache.write")} AS cacheWrite,
             COALESCE(SUM(COALESCE(json_extract(info, '$.cost'), 0)), 0) AS cost
           FROM message_info
           WHERE ${HAS_MODEL} AND ${DAY_OF} BETWEEN ? AND ?
           GROUP BY 1`,
        )
        .all(from, to)) {
        const day = ensure(row.date)
        day.sessions = num(row.sessions)
        day.messages = num(row.messages)
        day.tokens = {
          input: num(row.input),
          output: num(row.output),
          reasoning: num(row.reasoning),
          cacheRead: num(row.cacheRead),
          cacheWrite: num(row.cacheWrite),
        }
        day.cost = num(row.cost)
      }

      for (const row of db
        .query<{ date: string; provider: string; messages: number; tokens: number; cost: number }, [string, string]>(
          `SELECT
             ${DAY_OF} AS date,
             json_extract(info, '$.providerID') AS provider,
             COUNT(*) AS messages,
             ${token("input")} + ${token("output")} + ${token("reasoning")} AS tokens,
             COALESCE(SUM(COALESCE(json_extract(info, '$.cost'), 0)), 0) AS cost
           FROM message_info
           WHERE ${HAS_MODEL} AND ${DAY_OF} BETWEEN ? AND ?
           GROUP BY 1, 2`,
        )
        .all(from, to)) {
        if (!row.provider) continue
        ensure(row.date).providers[row.provider] = {
          messages: num(row.messages),
          tokens: num(row.tokens),
          cost: num(row.cost),
        }
      }

      for (const row of db
        .query<
          { date: string; provider: string; model: string; messages: number; tokens: number; cost: number },
          [string, string]
        >(
          `SELECT
             ${DAY_OF} AS date,
             json_extract(info, '$.providerID') AS provider,
             json_extract(info, '$.modelID') AS model,
             COUNT(*) AS messages,
             ${token("input")} + ${token("output")} + ${token("reasoning")} AS tokens,
             COALESCE(SUM(COALESCE(json_extract(info, '$.cost'), 0)), 0) AS cost
           FROM message_info
           WHERE ${HAS_MODEL} AND ${DAY_OF} BETWEEN ? AND ?
           GROUP BY 1, 2, 3`,
        )
        .all(from, to)) {
        if (!row.provider || !row.model) continue
        ensure(row.date).models[`${row.provider}/${row.model}`] = {
          messages: num(row.messages),
          tokens: num(row.tokens),
          cost: num(row.cost),
        }
      }

      for (const row of db
        .query<{ date: string; tool: string; calls: number; success: number; error: number }, [string, string]>(
          `SELECT
             date(m.created_at / 1000, 'unixepoch') AS date,
             COALESCE(json_extract(p.info, '$.tool'), 'unknown') AS tool,
             COUNT(*) AS calls,
             SUM(CASE WHEN json_extract(p.info, '$.state.status') = 'completed' THEN 1 ELSE 0 END) AS success,
             SUM(CASE WHEN json_extract(p.info, '$.state.status') = 'error' THEN 1 ELSE 0 END) AS error
           FROM message_part p
           JOIN message_info m ON m.id = p.message_id
           WHERE p.type = 'tool' AND date(m.created_at / 1000, 'unixepoch') BETWEEN ? AND ?
           GROUP BY 1, 2`,
        )
        .all(from, to)) {
        const day = ensure(row.date)
        day.toolCalls += num(row.calls)
        day.tools[row.tool || "unknown"] = {
          calls: num(row.calls),
          success: num(row.success),
          error: num(row.error),
        }
      }

      return [...days.values()].sort((a, b) => a.date.localeCompare(b.date))
    } catch (error) {
      log.error("Failed to read daily analytics", { error })
      return []
    }
  }

  function sessionRow(row: {
    sessionID: string
    projectID: string
    directory: string
    title: string
    providerID: string | null
    modelID: string | null
    messages: number
    input: number
    output: number
    reasoning: number
    cacheRead: number
    cacheWrite: number
    cost: number
    toolCalls: number
    created: number
    completed: number
  }): SessionAnalytics {
    return {
      sessionID: row.sessionID,
      projectID: row.projectID,
      directory: row.directory,
      title: row.title,
      providerID: row.providerID || "unknown",
      modelID: row.modelID || "unknown",
      messages: num(row.messages),
      tokens: {
        input: num(row.input),
        output: num(row.output),
        reasoning: num(row.reasoning),
        cacheRead: num(row.cacheRead),
        cacheWrite: num(row.cacheWrite),
      },
      cost: num(row.cost),
      toolCalls: num(row.toolCalls),
      duration: Math.max(0, num(row.completed) - num(row.created)),
      time: { created: num(row.created), completed: num(row.completed) },
    }
  }

  const SESSION_SELECT = `
    SELECT
      s.id AS sessionID,
      s.project_id AS projectID,
      s.directory,
      s.title,
      (SELECT json_extract(info, '$.providerID') FROM message_info
        WHERE session_id = s.id AND role = 'assistant' AND json_extract(info, '$.providerID') IS NOT NULL
        ORDER BY created_at DESC LIMIT 1) AS providerID,
      (SELECT json_extract(info, '$.modelID') FROM message_info
        WHERE session_id = s.id AND role = 'assistant' AND json_extract(info, '$.modelID') IS NOT NULL
        ORDER BY created_at DESC LIMIT 1) AS modelID,
      COALESCE(SUM(CASE WHEN m.role = 'assistant' THEN 1 ELSE 0 END), 0) AS messages,
      COALESCE(SUM(CASE WHEN m.role = 'assistant' THEN COALESCE(json_extract(m.info, '$.tokens.input'), 0) ELSE 0 END), 0) AS input,
      COALESCE(SUM(CASE WHEN m.role = 'assistant' THEN COALESCE(json_extract(m.info, '$.tokens.output'), 0) ELSE 0 END), 0) AS output,
      COALESCE(SUM(CASE WHEN m.role = 'assistant' THEN COALESCE(json_extract(m.info, '$.tokens.reasoning'), 0) ELSE 0 END), 0) AS reasoning,
      COALESCE(SUM(CASE WHEN m.role = 'assistant' THEN COALESCE(json_extract(m.info, '$.tokens.cache.read'), 0) ELSE 0 END), 0) AS cacheRead,
      COALESCE(SUM(CASE WHEN m.role = 'assistant' THEN COALESCE(json_extract(m.info, '$.tokens.cache.write'), 0) ELSE 0 END), 0) AS cacheWrite,
      COALESCE(SUM(CASE WHEN m.role = 'assistant' THEN COALESCE(json_extract(m.info, '$.cost'), 0) ELSE 0 END), 0) AS cost,
      (SELECT COUNT(*) FROM message_part p WHERE p.session_id = s.id AND p.type = 'tool') AS toolCalls,
      s.created_at AS created,
      s.updated_at AS completed
    FROM session_info s
    LEFT JOIN message_info m ON m.session_id = s.id`

  export async function getSession(sessionID: string): Promise<SessionAnalytics | null> {
    try {
      const row = native()
        .query<Parameters<typeof sessionRow>[0], [string]>(`${SESSION_SELECT} WHERE s.id = ? GROUP BY s.id`)
        .get(sessionID)
      return row ? sessionRow(row) : null
    } catch (error) {
      log.error("Failed to read session analytics", { error, sessionID })
      return null
    }
  }

  export async function getAllSessions(): Promise<SessionAnalytics[]> {
    try {
      return native()
        .query<Parameters<typeof sessionRow>[0], []>(`${SESSION_SELECT} GROUP BY s.id ORDER BY s.updated_at DESC`)
        .all()
        .map(sessionRow)
    } catch (error) {
      log.error("Failed to read session analytics list", { error })
      return []
    }
  }

  export function retentionDate(): string {
    const d = new Date()
    d.setUTCDate(d.getUTCDate() - 365)
    return d.toISOString().split("T")[0]
  }

  /** @deprecated Daily snapshots are no longer stored. */
  export async function compactOldDays(): Promise<void> {}
}

function maxTokenBreakdown(a: TokenBreakdown, b: TokenBreakdown): TokenBreakdown {
  return {
    input: Math.max(a.input, b.input),
    output: Math.max(a.output, b.output),
    reasoning: Math.max(a.reasoning, b.reasoning),
    cacheRead: Math.max(a.cacheRead, b.cacheRead),
    cacheWrite: Math.max(a.cacheWrite, b.cacheWrite),
  }
}

/**
 * Merge two persisted global analytics snapshots (e.g. API vs on-disk under `Global.Path.data`).
 * Per-metric max so the TUI never drops totals when one source is partial.
 */
export function mergeGlobalAnalytics(a: GlobalAnalytics, b: GlobalAnalytics): GlobalAnalytics {
  const byProvider: GlobalAnalytics["byProvider"] = { ...a.byProvider }
  for (const [id, row] of Object.entries(b.byProvider)) {
    const ex = byProvider[id]
    if (!ex) {
      byProvider[id] = { ...row }
    } else {
      byProvider[id] = {
        sessions: Math.max(ex.sessions, row.sessions),
        messages: Math.max(ex.messages, row.messages),
        tokens: Math.max(ex.tokens, row.tokens),
        cost: Math.max(ex.cost, row.cost),
      }
    }
  }

  const byModel: GlobalAnalytics["byModel"] = { ...a.byModel }
  for (const [id, row] of Object.entries(b.byModel)) {
    const ex = byModel[id]
    if (!ex) {
      byModel[id] = { ...row }
    } else {
      byModel[id] = {
        sessions: Math.max(ex.sessions, row.sessions),
        messages: Math.max(ex.messages, row.messages),
        tokens: {
          input: Math.max(ex.tokens.input, row.tokens.input),
          output: Math.max(ex.tokens.output, row.tokens.output),
          reasoning: Math.max(ex.tokens.reasoning, row.tokens.reasoning),
        },
        cost: Math.max(ex.cost, row.cost),
        firstUsed: Math.min(ex.firstUsed, row.firstUsed),
        lastUsed: Math.max(ex.lastUsed, row.lastUsed),
      }
    }
  }

  const byProject: GlobalAnalytics["byProject"] = { ...a.byProject }
  for (const [id, row] of Object.entries(b.byProject)) {
    const ex = byProject[id]
    if (!ex) {
      byProject[id] = { ...row }
    } else {
      byProject[id] = {
        sessions: Math.max(ex.sessions, row.sessions),
        tokens: Math.max(ex.tokens, row.tokens),
        cost: Math.max(ex.cost, row.cost),
        lastActive: Math.max(ex.lastActive, row.lastActive),
      }
    }
  }

  return {
    version: 1,
    updatedAt: Math.max(a.updatedAt, b.updatedAt),
    totals: {
      sessions: Math.max(a.totals.sessions, b.totals.sessions),
      messages: Math.max(a.totals.messages, b.totals.messages),
      tokens: maxTokenBreakdown(a.totals.tokens, b.totals.tokens),
      cost: Math.max(a.totals.cost, b.totals.cost),
      toolCalls: Math.max(a.totals.toolCalls, b.totals.toolCalls),
    },
    byProvider,
    byModel,
    byProject,
  }
}

function mergeDailyToolStats(a: DailyAnalytics["tools"], b: DailyAnalytics["tools"]): DailyAnalytics["tools"] {
  const out: DailyAnalytics["tools"] = { ...a }
  for (const [name, row] of Object.entries(b)) {
    const ex = out[name]
    if (!ex) out[name] = { ...row }
    else {
      out[name] = {
        calls: Math.max(ex.calls, row.calls),
        success: Math.max(ex.success, row.success),
        error: Math.max(ex.error, row.error),
      }
    }
  }
  return out
}

function mergeDailyProviderStats(
  a: DailyAnalytics["providers"],
  b: DailyAnalytics["providers"],
): DailyAnalytics["providers"] {
  const out: DailyAnalytics["providers"] = { ...a }
  for (const [id, row] of Object.entries(b)) {
    const ex = out[id]
    if (!ex) out[id] = { ...row }
    else {
      out[id] = {
        messages: Math.max(ex.messages, row.messages),
        tokens: Math.max(ex.tokens, row.tokens),
        cost: Math.max(ex.cost, row.cost),
      }
    }
  }
  return out
}

function mergeDailyModelStats(a: DailyAnalytics["models"], b: DailyAnalytics["models"]): DailyAnalytics["models"] {
  const out: DailyAnalytics["models"] = { ...a }
  for (const [id, row] of Object.entries(b)) {
    const ex = out[id]
    if (!ex) out[id] = { ...row }
    else {
      out[id] = {
        messages: Math.max(ex.messages, row.messages),
        tokens: Math.max(ex.tokens, row.tokens),
        cost: Math.max(ex.cost, row.cost),
      }
    }
  }
  return out
}

export function mergeDailyAnalytics(a: DailyAnalytics, b: DailyAnalytics): DailyAnalytics {
  return {
    date: a.date,
    sessions: Math.max(a.sessions, b.sessions),
    messages: Math.max(a.messages, b.messages),
    tokens: maxTokenBreakdown(a.tokens, b.tokens),
    cost: Math.max(a.cost, b.cost),
    toolCalls: Math.max(a.toolCalls, b.toolCalls),
    tools: mergeDailyToolStats(a.tools, b.tools),
    providers: mergeDailyProviderStats(a.providers, b.providers),
    models: mergeDailyModelStats(a.models, b.models),
    recordedAt: Math.max(a.recordedAt, b.recordedAt),
  }
}

export function mergeDailyAnalyticsLists(a: DailyAnalytics[], b: DailyAnalytics[]): DailyAnalytics[] {
  const map = new Map<string, DailyAnalytics>()
  for (const d of a) map.set(d.date, d)
  for (const d of b) {
    const ex = map.get(d.date)
    if (!ex) map.set(d.date, d)
    else map.set(d.date, mergeDailyAnalytics(ex, d))
  }
  return [...map.values()].sort((x, y) => x.date.localeCompare(y.date))
}

export function mergeSessionAnalyticsLists(a: SessionAnalytics[], b: SessionAnalytics[]): SessionAnalytics[] {
  const map = new Map<string, SessionAnalytics>()
  for (const s of a) map.set(s.sessionID, s)
  for (const s of b) {
    const ex = map.get(s.sessionID)
    if (!ex) {
      map.set(s.sessionID, s)
    } else {
      map.set(s.sessionID, {
        ...ex,
        title: ex.title && ex.title.length >= s.title.length ? ex.title : s.title,
        messages: Math.max(ex.messages, s.messages),
        tokens: maxTokenBreakdown(ex.tokens, s.tokens),
        cost: Math.max(ex.cost, s.cost),
        toolCalls: Math.max(ex.toolCalls, s.toolCalls),
        duration: Math.max(ex.duration, s.duration),
        time: {
          created: Math.min(ex.time.created, s.time.created),
          completed: Math.max(ex.time.completed, s.time.completed),
        },
      })
    }
  }
  return [...map.values()].sort((x, y) => y.time.completed - x.time.completed)
}

/**
 * Leftover JSON snapshots are no longer a runtime source. The HTTP handlers
 * query SQL; this stays so the TUI refresh path does not have to know.
 */
export async function loadPersistedAnalyticsFromDataRoot(_dataRoot: string): Promise<{
  global: GlobalAnalytics | null
  daily: DailyAnalytics[]
  sessions: SessionAnalytics[]
}> {
  return { global: null, daily: [], sessions: [] }
}
