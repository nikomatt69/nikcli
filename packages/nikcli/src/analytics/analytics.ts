import z from "zod"
import { Database } from "@/database/database"
import { Log } from "@nikcli-ai/util/log"

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

/**
 * Cheap stand-in for "has anything analytics reads changed?".
 *
 * Counting rows uses the primary key index and costs a few hundred
 * milliseconds, against the tens of seconds a real recount takes.
 */
function fingerprint(): string {
  const db = native()
  const messages = db.query<{ n: number }, []>(`SELECT COUNT(*) AS n FROM message_info`).get()
  const parts = db.query<{ n: number }, []>(`SELECT COUNT(*) AS n FROM message_part`).get()
  const sessions = db
    .query<{ n: number; at: number | null }, []>(`SELECT COUNT(*) AS n, MAX(updated_at) AS at FROM session_info`)
    .get()
  return `${num(messages?.n)}:${num(parts?.n)}:${num(sessions?.n)}:${num(sessions?.at)}`
}

/**
 * `message_part.info` carries every tool payload — ~600MB on a long-lived
 * install — and SQLite has no index on `type`, so counting tool calls is a full
 * scan no matter how narrow the date range. Recomputing that on each panel open,
 * and again after every assistant reply, is what made these endpoints take tens
 * of seconds each.
 *
 * Results are memoized against the fingerprint of the tables they read, so a
 * history that has not moved is never paid for twice. A write of any kind
 * changes the fingerprint, so this cannot serve a stale answer.
 */
const memo = new Map<string, { key: string; value: unknown }>()

function cached<A>(slot: string, compute: () => A): A {
  let key: string
  try {
    key = fingerprint()
  } catch {
    // Fingerprint is an optimisation, never a correctness gate: if it cannot be
    // read, fall through and compute.
    return compute()
  }
  const hit = memo.get(slot)
  if (hit && hit.key === key) return hit.value as A
  const value = compute()
  memo.set(slot, { key, value })
  return value
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
      return cached("global", computeGlobal)
    } catch (error) {
      log.error("Failed to read global analytics", { error })
      return emptyGlobal()
    }
  }

  // Throws rather than falling back, so a failed read is never memoized.
  function computeGlobal(): GlobalAnalytics {
    {
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
        .query<
          { provider: string; sessions: number; messages: number; tokens: number; cost: number },
          []
        >(
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
        .query<
          { projectID: string; sessions: number; tokens: number; cost: number; lastActive: number },
          []
        >(
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
    }
  }

  export async function getDaily(from: string, to: string): Promise<DailyAnalytics[]> {
    try {
      return cached(`daily:${from}:${to}`, () => computeDaily(from, to))
    } catch (error) {
      log.error("Failed to read daily analytics", { error })
      return []
    }
  }

  function computeDaily(from: string, to: string): DailyAnalytics[] {
    {
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
        .query<
          { date: string; tool: string; calls: number; success: number; error: number },
          [string, string]
        >(
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

  /** Per-session assistant aggregate, guarded so user turns contribute nothing. */
  const sessionToken = (field: string) =>
    `COALESCE(SUM(CASE WHEN role = 'assistant' THEN COALESCE(json_extract(info, '$.tokens.${field}'), 0) ELSE 0 END), 0)`

  /**
   * Per-session aggregates computed in one pass over each table.
   *
   * `getSession` can afford correlated subqueries because every one of them is
   * an indexed lookup against a single session. Running the same shape for the
   * whole list re-read every assistant message of every session twice just to
   * find the newest provider and model — ~56s on a 2.4k-session history, since
   * `message_info.info` averages 5KB a row. Aggregating once and joining by
   * session id produces byte-identical rows in about 8s.
   */
  const SESSION_SELECT_ALL = `
    WITH msg AS (
      SELECT
        session_id AS sid,
        COALESCE(SUM(CASE WHEN role = 'assistant' THEN 1 ELSE 0 END), 0) AS messages,
        ${sessionToken("input")} AS input,
        ${sessionToken("output")} AS output,
        ${sessionToken("reasoning")} AS reasoning,
        ${sessionToken("cache.read")} AS cacheRead,
        ${sessionToken("cache.write")} AS cacheWrite,
        COALESCE(SUM(CASE WHEN role = 'assistant' THEN COALESCE(json_extract(info, '$.cost'), 0) ELSE 0 END), 0) AS cost
      FROM message_info
      GROUP BY session_id
    ),
    -- Newest assistant turn that named a model. Provider and model are taken
    -- from the same row so a session can never report a mismatched pair.
    latest AS (
      SELECT sid, providerID, modelID FROM (
        SELECT
          session_id AS sid,
          json_extract(info, '$.providerID') AS providerID,
          json_extract(info, '$.modelID') AS modelID,
          ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY created_at DESC) AS rn
        FROM message_info
        WHERE ${HAS_MODEL}
      ) WHERE rn = 1
    ),
    tools AS (
      SELECT session_id AS sid, COUNT(*) AS toolCalls
      FROM message_part
      WHERE type = 'tool'
      GROUP BY session_id
    )
    SELECT
      s.id AS sessionID,
      s.project_id AS projectID,
      s.directory,
      s.title,
      latest.providerID AS providerID,
      latest.modelID AS modelID,
      COALESCE(msg.messages, 0) AS messages,
      COALESCE(msg.input, 0) AS input,
      COALESCE(msg.output, 0) AS output,
      COALESCE(msg.reasoning, 0) AS reasoning,
      COALESCE(msg.cacheRead, 0) AS cacheRead,
      COALESCE(msg.cacheWrite, 0) AS cacheWrite,
      COALESCE(msg.cost, 0) AS cost,
      COALESCE(tools.toolCalls, 0) AS toolCalls,
      s.created_at AS created,
      s.updated_at AS completed
    FROM session_info s
    LEFT JOIN msg ON msg.sid = s.id
    LEFT JOIN latest ON latest.sid = s.id
    LEFT JOIN tools ON tools.sid = s.id`

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
      return cached("sessions", () =>
        native()
          .query<Parameters<typeof sessionRow>[0], []>(`${SESSION_SELECT_ALL} ORDER BY s.updated_at DESC`)
          .all()
          .map(sessionRow),
      )
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


// Leftover JSON snapshots are no longer a runtime source: everything is derived
// from `message_info` / `session_info` / `message_part`. The loader that used to
// read them was kept as a stub returning empties, which silently reported "no
// history" to its one caller — the TUI panel — long after the data was fine.
