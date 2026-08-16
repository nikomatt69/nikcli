/**
 * Merging the analytics payloads the panel receives.
 *
 * The TUI asks for three payloads that overlap — live sync, `/analytics/{global,daily}`, and the
 * session list — and each may be partial or a beat behind. Every field merges by `Math.max` (or
 * `Math.min` for "first seen" timestamps) so a slower or truncated source can never subtract from
 * what is already on screen.
 *
 * These lived in `@/analytics/analytics` and were pulled in with `await import()`, which kept a
 * backend module in the panel's runtime graph for what is pure arithmetic over wire shapes. No
 * server code ever called them. Types come from the contract; see specs/tui-package.md §3.
 */
import type {
  AnalyticsDaily as DailyAnalytics,
  AnalyticsGlobal as GlobalAnalytics,
  AnalyticsSession as SessionAnalytics,
  AnalyticsTokenBreakdown as TokenBreakdown,
} from "@nikcli-ai/sdk/httpapi"

export type { DailyAnalytics, GlobalAnalytics, SessionAnalytics, TokenBreakdown }

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
