import z from "zod"
import path from "path"
import { Storage } from "../storage/storage"
import { Log } from "../util/log"
import { Effect } from "effect"
import { runPromiseWithLayer } from "@/effect"

function runStorage<A, E>(effect: Effect.Effect<A, E, Storage.Service>) {
  return runPromiseWithLayer(Storage.defaultLayer, effect)
}

function storageRead<T>(key: string[]) {
  return runStorage(
    Effect.gen(function* () {
      const storage = yield* Storage.Service
      return yield* storage.read<T>(key)
    }),
  )
}

function storageWrite<T>(key: string[], content: T) {
  return runStorage(
    Effect.gen(function* () {
      const storage = yield* Storage.Service
      yield* storage.write(key, content)
    }),
  )
}

function storageUpdate<T>(key: string[], fn: (draft: T) => void) {
  return runStorage(
    Effect.gen(function* () {
      const storage = yield* Storage.Service
      return yield* storage.update(key, fn)
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

// ===== Schemas =====

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

// ===== Helpers =====

function dateKey(timestamp: number): string {
  return new Date(timestamp).toISOString().split("T")[0]
}

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

function emptyDaily(date: string): DailyAnalytics {
  return {
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
}

// ===== Analytics Service =====

export namespace Analytics {
  const log = Log.create({ service: "analytics" })

  /**
   * Record an assistant message completion.
   * Updates global totals and daily snapshot.
   */
  export async function recordMessage(data: {
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
  }): Promise<void> {
    try {
      const dk = dateKey(data.timestamp)
      const modelKey = `${data.providerID}/${data.modelID}`
      const tokenTotal = data.tokens.input + data.tokens.output + data.tokens.reasoning

      // Update global analytics
      await storageUpdate<GlobalAnalytics>(["analytics", "global"], (draft) => {
        if (!draft || !draft.version) {
          Object.assign(draft, emptyGlobal())
        }
        draft.updatedAt = Date.now()
        draft.totals.messages++
        draft.totals.tokens.input += data.tokens.input
        draft.totals.tokens.output += data.tokens.output
        draft.totals.tokens.reasoning += data.tokens.reasoning
        draft.totals.tokens.cacheRead += data.tokens.cache.read
        draft.totals.tokens.cacheWrite += data.tokens.cache.write
        draft.totals.cost += data.cost

        // Provider
        if (!draft.byProvider[data.providerID]) {
          draft.byProvider[data.providerID] = { sessions: 0, messages: 0, tokens: 0, cost: 0 }
        }
        const prov = draft.byProvider[data.providerID]
        prov.messages++
        prov.tokens += tokenTotal
        prov.cost += data.cost

        // Model
        if (!draft.byModel[modelKey]) {
          draft.byModel[modelKey] = {
            sessions: 0,
            messages: 0,
            tokens: { input: 0, output: 0, reasoning: 0 },
            cost: 0,
            firstUsed: data.timestamp,
            lastUsed: data.timestamp,
          }
        }
        const model = draft.byModel[modelKey]
        model.messages++
        model.tokens.input += data.tokens.input
        model.tokens.output += data.tokens.output
        model.tokens.reasoning += data.tokens.reasoning
        model.cost += data.cost
        model.lastUsed = Math.max(model.lastUsed, data.timestamp)

        // Project
        const projectID = data.projectID || "default"
        if (!draft.byProject[projectID]) {
          draft.byProject[projectID] = { sessions: 0, tokens: 0, cost: 0, lastActive: data.timestamp }
        }
        const proj = draft.byProject[projectID]
        proj.tokens += tokenTotal
        proj.cost += data.cost
        proj.lastActive = Math.max(proj.lastActive, data.timestamp)
      }).catch((e) => {
        // If update fails (e.g., first time), write fresh
        const fresh = emptyGlobal()
        fresh.totals.messages = 1
        fresh.totals.tokens = {
          input: data.tokens.input,
          output: data.tokens.output,
          reasoning: data.tokens.reasoning,
          cacheRead: data.tokens.cache.read,
          cacheWrite: data.tokens.cache.write,
        }
        fresh.totals.cost = data.cost
        fresh.byProvider[data.providerID] = { sessions: 0, messages: 1, tokens: tokenTotal, cost: data.cost }
        fresh.byModel[modelKey] = {
          sessions: 0,
          messages: 1,
          tokens: { input: data.tokens.input, output: data.tokens.output, reasoning: data.tokens.reasoning },
          cost: data.cost,
          firstUsed: data.timestamp,
          lastUsed: data.timestamp,
        }
        fresh.byProject[data.projectID || "default"] = {
          sessions: 0,
          tokens: tokenTotal,
          cost: data.cost,
          lastActive: data.timestamp,
        }
        return storageWrite(["analytics", "global"], fresh)
      })

      // Update daily snapshot
      await storageUpdate<DailyAnalytics>(["analytics", "daily", dk], (draft) => {
        if (!draft || !draft.date) {
          Object.assign(draft, emptyDaily(dk))
        }
        draft.messages++
        draft.tokens.input += data.tokens.input
        draft.tokens.output += data.tokens.output
        draft.tokens.reasoning += data.tokens.reasoning
        draft.tokens.cacheRead += data.tokens.cache.read
        draft.tokens.cacheWrite += data.tokens.cache.write
        draft.cost += data.cost
        draft.recordedAt = Date.now()

        // Provider daily
        if (!draft.providers[data.providerID]) {
          draft.providers[data.providerID] = { messages: 0, tokens: 0, cost: 0 }
        }
        draft.providers[data.providerID].messages++
        draft.providers[data.providerID].tokens += tokenTotal
        draft.providers[data.providerID].cost += data.cost

        // Model daily
        if (!draft.models[modelKey]) {
          draft.models[modelKey] = { messages: 0, tokens: 0, cost: 0 }
        }
        draft.models[modelKey].messages++
        draft.models[modelKey].tokens += tokenTotal
        draft.models[modelKey].cost += data.cost
      }).catch(() => {
        const fresh = emptyDaily(dk)
        fresh.messages = 1
        fresh.tokens = {
          input: data.tokens.input,
          output: data.tokens.output,
          reasoning: data.tokens.reasoning,
          cacheRead: data.tokens.cache.read,
          cacheWrite: data.tokens.cache.write,
        }
        fresh.cost = data.cost
        fresh.providers[data.providerID] = { messages: 1, tokens: tokenTotal, cost: data.cost }
        fresh.models[modelKey] = { messages: 1, tokens: tokenTotal, cost: data.cost }
        return storageWrite(["analytics", "daily", dk], fresh)
      })
    } catch (e) {
      log.error("Failed to record message analytics", { error: e })
    }
  }

  /**
   * Record session creation.
   */
  export async function recordSession(data: {
    sessionID: string
    projectID: string
    directory: string
    timestamp: number
  }): Promise<void> {
    try {
      const dk = dateKey(data.timestamp)

      await storageUpdate<GlobalAnalytics>(["analytics", "global"], (draft) => {
        if (!draft || !draft.version) {
          Object.assign(draft, emptyGlobal())
        }
        draft.updatedAt = Date.now()
        draft.totals.sessions++

        const projectID = data.projectID || "default"
        if (!draft.byProject[projectID]) {
          draft.byProject[projectID] = { sessions: 0, tokens: 0, cost: 0, lastActive: data.timestamp }
        }
        draft.byProject[projectID].sessions++
        draft.byProject[projectID].lastActive = Math.max(draft.byProject[projectID].lastActive, data.timestamp)
      }).catch(() => {
        const fresh = emptyGlobal()
        fresh.totals.sessions = 1
        fresh.byProject[data.projectID || "default"] = { sessions: 1, tokens: 0, cost: 0, lastActive: data.timestamp }
        return storageWrite(["analytics", "global"], fresh)
      })

      await storageUpdate<DailyAnalytics>(["analytics", "daily", dk], (draft) => {
        if (!draft || !draft.date) {
          Object.assign(draft, emptyDaily(dk))
        }
        draft.sessions++
        draft.recordedAt = Date.now()
      }).catch(() => {
        const fresh = emptyDaily(dk)
        fresh.sessions = 1
        return storageWrite(["analytics", "daily", dk], fresh)
      })
    } catch (e) {
      log.error("Failed to record session analytics", { error: e })
    }
  }

  /**
   * Record tool usage.
   */
  export async function recordToolUse(data: {
    toolName: string
    sessionID: string
    success: boolean
    timestamp: number
  }): Promise<void> {
    try {
      const dk = dateKey(data.timestamp)

      await storageUpdate<GlobalAnalytics>(["analytics", "global"], (draft) => {
        if (!draft || !draft.version) {
          Object.assign(draft, emptyGlobal())
        }
        draft.updatedAt = Date.now()
        draft.totals.toolCalls++
      }).catch(() => {
        const fresh = emptyGlobal()
        fresh.totals.toolCalls = 1
        return storageWrite(["analytics", "global"], fresh)
      })

      await storageUpdate<DailyAnalytics>(["analytics", "daily", dk], (draft) => {
        if (!draft || !draft.date) {
          Object.assign(draft, emptyDaily(dk))
        }
        draft.toolCalls++
        draft.recordedAt = Date.now()

        if (!draft.tools[data.toolName]) {
          draft.tools[data.toolName] = { calls: 0, success: 0, error: 0 }
        }
        draft.tools[data.toolName].calls++
        if (data.success) {
          draft.tools[data.toolName].success++
        } else {
          draft.tools[data.toolName].error++
        }
      }).catch(() => {
        const fresh = emptyDaily(dk)
        fresh.toolCalls = 1
        fresh.tools[data.toolName] = { calls: 1, success: data.success ? 1 : 0, error: data.success ? 0 : 1 }
        return storageWrite(["analytics", "daily", dk], fresh)
      })
    } catch (e) {
      log.error("Failed to record tool analytics", { error: e })
    }
  }

  /**
   * Record session-level snapshot on session end/archival.
   */
  export async function recordSessionEnd(data: {
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
  }): Promise<void> {
    try {
      await storageWrite<SessionAnalytics>(["analytics", "session", data.sessionID], {
        sessionID: data.sessionID,
        projectID: data.projectID,
        directory: data.directory,
        title: data.title,
        providerID: data.providerID,
        modelID: data.modelID,
        messages: data.messages,
        tokens: data.tokens,
        cost: data.cost,
        toolCalls: data.toolCalls,
        duration: data.duration,
        time: {
          created: data.created,
          completed: data.completed,
        },
      })

      // Update model session count in global
      const modelKey = `${data.providerID}/${data.modelID}`
      await storageUpdate<GlobalAnalytics>(["analytics", "global"], (draft) => {
        if (!draft || !draft.version) return
        if (draft.byModel[modelKey]) {
          draft.byModel[modelKey].sessions++
        }
        if (draft.byProvider[data.providerID]) {
          draft.byProvider[data.providerID].sessions++
        }
      }).catch(() => {})
    } catch (e) {
      log.error("Failed to record session end analytics", { error: e })
    }
  }

  /**
   * Backfill analytics from existing session/message data.
   * One-time migration for users upgrading to analytics.
   */
  export async function backfillFromExisting(): Promise<void> {
    try {
      // Check if already backfilled
      const existing = await storageRead<GlobalAnalytics>(["analytics", "global"]).catch(() => null)
      if (existing && existing.version === 1) {
        log.info("Analytics already backfilled, skipping")
        return
      }

      log.info("Starting analytics backfill from existing data...")
      const global = emptyGlobal()

      // Scan all projects
      const projectKeys = await storageList(["project"])
      for (const key of projectKeys) {
        try {
          const project = await storageRead<{ id: string }>(key)
          if (!project?.id) continue

          // Scan sessions for this project
          const sessionKeys = await storageList(["session", project.id])
          for (const sessionKey of sessionKeys) {
            try {
              const session = await storageRead<{
                id: string
                projectID: string
                directory: string
                title: string
                time: { created: number; updated: number; archived?: number }
              }>(sessionKey)

              global.totals.sessions++
              const projID = session.projectID || "default"
              if (!global.byProject[projID]) {
                global.byProject[projID] = { sessions: 0, tokens: 0, cost: 0, lastActive: session.time.updated }
              }
              global.byProject[projID].sessions++

              // Scan messages for this session
              const messageKeys = await storageList(["message", session.id])
              for (const msgKey of messageKeys) {
                try {
                  const msg = await storageRead<{
                    role: string
                    tokens?: {
                      input: number
                      output: number
                      reasoning: number
                      cache?: { read: number; write: number }
                    }
                    cost?: number
                    providerID?: string
                    modelID?: string
                    time?: { created?: number; completed?: number }
                  }>(msgKey)

                  if (msg.role !== "assistant" || !msg.tokens) continue

                  const input = msg.tokens.input || 0
                  const output = msg.tokens.output || 0
                  const reasoning = msg.tokens.reasoning || 0
                  const cacheRead = msg.tokens.cache?.read || 0
                  const cacheWrite = msg.tokens.cache?.write || 0
                  const cost = msg.cost || 0
                  const providerID = msg.providerID || "unknown"
                  const modelID = msg.modelID || "unknown"
                  const modelKey = `${providerID}/${modelID}`
                  const timestamp = msg.time?.completed || msg.time?.created || session.time.updated
                  const dk = dateKey(timestamp)
                  const tokenTotal = input + output + reasoning

                  // Update global
                  global.totals.messages++
                  global.totals.tokens.input += input
                  global.totals.tokens.output += output
                  global.totals.tokens.reasoning += reasoning
                  global.totals.tokens.cacheRead += cacheRead
                  global.totals.tokens.cacheWrite += cacheWrite
                  global.totals.cost += cost

                  // Provider
                  if (!global.byProvider[providerID]) {
                    global.byProvider[providerID] = { sessions: 0, messages: 0, tokens: 0, cost: 0 }
                  }
                  global.byProvider[providerID].messages++
                  global.byProvider[providerID].tokens += tokenTotal
                  global.byProvider[providerID].cost += cost

                  // Model
                  if (!global.byModel[modelKey]) {
                    global.byModel[modelKey] = {
                      sessions: 0,
                      messages: 0,
                      tokens: { input: 0, output: 0, reasoning: 0 },
                      cost: 0,
                      firstUsed: timestamp,
                      lastUsed: timestamp,
                    }
                  }
                  global.byModel[modelKey].messages++
                  global.byModel[modelKey].tokens.input += input
                  global.byModel[modelKey].tokens.output += output
                  global.byModel[modelKey].tokens.reasoning += reasoning
                  global.byModel[modelKey].cost += cost
                  global.byModel[modelKey].firstUsed = Math.min(global.byModel[modelKey].firstUsed, timestamp)
                  global.byModel[modelKey].lastUsed = Math.max(global.byModel[modelKey].lastUsed, timestamp)

                  // Project
                  global.byProject[projID].tokens += tokenTotal
                  global.byProject[projID].cost += cost
                  global.byProject[projID].lastActive = Math.max(global.byProject[projID].lastActive, timestamp)

                  // Daily snapshot
                  await storageUpdate<DailyAnalytics>(["analytics", "daily", dk], (draft) => {
                    if (!draft || !draft.date) {
                      Object.assign(draft, emptyDaily(dk))
                    }
                    draft.messages++
                    draft.tokens.input += input
                    draft.tokens.output += output
                    draft.tokens.reasoning += reasoning
                    draft.tokens.cacheRead += cacheRead
                    draft.tokens.cacheWrite += cacheWrite
                    draft.cost += cost
                    draft.recordedAt = Date.now()

                    if (!draft.providers[providerID]) {
                      draft.providers[providerID] = { messages: 0, tokens: 0, cost: 0 }
                    }
                    draft.providers[providerID].messages++
                    draft.providers[providerID].tokens += tokenTotal
                    draft.providers[providerID].cost += cost

                    if (!draft.models[modelKey]) {
                      draft.models[modelKey] = { messages: 0, tokens: 0, cost: 0 }
                    }
                    draft.models[modelKey].messages++
                    draft.models[modelKey].tokens += tokenTotal
                    draft.models[modelKey].cost += cost
                  }).catch(() => {
                    const fresh = emptyDaily(dk)
                    fresh.messages = 1
                    fresh.tokens = { input, output, reasoning, cacheRead, cacheWrite }
                    fresh.cost = cost
                    fresh.providers[providerID] = { messages: 1, tokens: tokenTotal, cost }
                    fresh.models[modelKey] = { messages: 1, tokens: tokenTotal, cost }
                    return storageWrite(["analytics", "daily", dk], fresh)
                  })
                } catch {
                  // Skip unreadable messages
                }
              }
            } catch {
              // Skip unreadable sessions
            }
          }
        } catch {
          // Skip unreadable projects
        }
      }

      global.updatedAt = Date.now()
      await storageWrite(["analytics", "global"], global)
      log.info("Analytics backfill complete", {
        sessions: global.totals.sessions,
        messages: global.totals.messages,
        cost: global.totals.cost,
      })
    } catch (e) {
      log.error("Analytics backfill failed", { error: e })
    }
  }

  /**
   * Read global analytics.
   */
  export async function getGlobal(): Promise<GlobalAnalytics> {
    return storageRead<GlobalAnalytics>(["analytics", "global"]).catch(() => emptyGlobal())
  }

  /**
   * Read daily snapshots in a date range.
   */
  export async function getDaily(from: string, to: string): Promise<DailyAnalytics[]> {
    const keys = await storageList(["analytics", "daily"])
    const results: DailyAnalytics[] = []
    for (const key of keys) {
      const dk = key[2]
      if (!dk || dk < from || dk > to) continue
      try {
        const snap = await storageRead<DailyAnalytics>(key)
        if (snap && snap.date) results.push(snap)
      } catch {
        // Skip unreadable
      }
    }
    return results.sort((a, b) => a.date.localeCompare(b.date))
  }

  /**
   * Read session-level analytics.
   */
  export async function getSession(sessionID: string): Promise<SessionAnalytics | null> {
    return storageRead<SessionAnalytics>(["analytics", "session", sessionID]).catch(() => null)
  }

  /**
   * Read all session analytics.
   */
  export async function getAllSessions(): Promise<SessionAnalytics[]> {
    const keys = await storageList(["analytics", "session"])
    const results: SessionAnalytics[] = []
    for (const key of keys) {
      try {
        const snap = await storageRead<SessionAnalytics>(key)
        if (snap && snap.sessionID) results.push(snap)
      } catch {
        // Skip unreadable
      }
    }
    return results.sort((a, b) => b.time.completed - a.time.completed)
  }

  /**
   * Get the retention date (365 days ago).
   */
  export function retentionDate(): string {
    const d = new Date()
    d.setUTCDate(d.getUTCDate() - 365)
    return d.toISOString().split("T")[0]
  }

  /**
   * Clean up daily snapshots older than retention period.
   */
  export async function compactOldDays(): Promise<void> {
    const cutoff = retentionDate()
    const keys = await storageList(["analytics", "daily"])
    let removed = 0
    for (const key of keys) {
      const dk = key[2]
      if (!dk || dk >= cutoff) continue
      try {
        await runStorage(
          Effect.gen(function* () {
            const storage = yield* Storage.Service
            yield* storage.remove(key)
          }),
        )
        removed++
      } catch {
        // Skip
      }
    }
    if (removed > 0) {
      log.info("Compacted old analytics days", { removed })
    }
  }
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
 * Read persisted analytics JSON from disk (`<dataRoot>/storage/analytics/…`) without going through HTTP.
 * Uses the same layout as {@link Storage} (XDG data dir when `dataRoot` is `Global.Path.data`).
 */
export async function loadPersistedAnalyticsFromDataRoot(dataRoot: string): Promise<{
  global: GlobalAnalytics | null
  daily: DailyAnalytics[]
  sessions: SessionAnalytics[]
}> {
  const root = path.join(dataRoot, "storage", "analytics")
  const globalRaw = await Bun.file(path.join(root, "global.json"))
    .json()
    .catch(() => null)
  const global = globalRaw && GlobalAnalytics.safeParse(globalRaw).success ? GlobalAnalytics.parse(globalRaw) : null

  const daily: DailyAnalytics[] = []
  const dailyDir = path.join(root, "daily")
  try {
    for await (const file of new Bun.Glob("*.json").scan({ cwd: dailyDir, absolute: true })) {
      const raw = await Bun.file(file)
        .json()
        .catch(() => null)
      if (raw && DailyAnalytics.safeParse(raw).success) daily.push(DailyAnalytics.parse(raw))
    }
  } catch {
    // missing dir
  }
  daily.sort((x, y) => x.date.localeCompare(y.date))

  const sessions: SessionAnalytics[] = []
  const sessionDir = path.join(root, "session")
  try {
    for await (const file of new Bun.Glob("*.json").scan({ cwd: sessionDir, absolute: true })) {
      const raw = await Bun.file(file)
        .json()
        .catch(() => null)
      if (raw && SessionAnalytics.safeParse(raw).success) sessions.push(SessionAnalytics.parse(raw))
    }
  } catch {
    // missing dir
  }
  sessions.sort((a, b) => b.time.completed - a.time.completed)

  return { global, daily, sessions }
}
