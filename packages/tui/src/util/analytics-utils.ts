/**
 * Analytics panel helpers — period-over-period deltas, sparkline sampling,
 * and small formatting utilities used by the dialog.
 *
 * These are kept dependency-free (no OpenTUI/Solid imports) so they can be
 * unit-tested in isolation, mirroring the style of `analytics-aggregator.ts`.
 */
import type { DayStats, SessionStats, ToolUsageStats } from "@tui/util/analytics-aggregator"

// ===== Period deltas =====

export interface PeriodDelta {
  /** Sum/aggregate over the recent window. */
  current: number
  /** Sum/aggregate over the comparable preceding window of the same length. */
  previous: number
  /** Signed delta (current − previous). 0 when both are 0. */
  absolute: number
  /** Percentage change, clamped to ±∞ markers when previous is 0. */
  pct: number
  /**
   * - "up" when current > previous
   * - "down" when current < previous
   * - "flat" when equal
   */
  trend: "up" | "down" | "flat"
}

/**
 * Compare the most recent `windowDays` of `days` against the same-length
 * window immediately before it. Pass a `selector` to choose the metric being
 * summed (e.g. `d => d.cost`, `d => d.tokens`, `d => d.sessions`).
 *
 * When the previous window is empty, the previous value is treated as 0 — the
 * resulting `pct` is `Infinity` (or `-Infinity`) so callers can render a
 * "—" / "new" placeholder instead of "±∞%".
 */
export function periodDelta(
  days: DayStats[],
  windowDays: number,
  selector: (d: DayStats) => number = (d) => d.tokens,
): PeriodDelta {
  if (days.length === 0 || windowDays <= 0) {
    return { current: 0, previous: 0, absolute: 0, pct: 0, trend: "flat" }
  }
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date))
  const total = sorted.length
  // When the days array is shorter than `2 * windowDays`, fall back to the
  // longest comparable split (use whatever is available as the "previous"
  // window). This keeps the helper useful for low-history accounts.
  const currentWindow = sorted.slice(-windowDays)
  const previousWindow = sorted.slice(Math.max(0, total - 2 * windowDays), Math.max(0, total - windowDays))

  const current = currentWindow.reduce((sum, d) => sum + selector(d), 0)
  const previous = previousWindow.reduce((sum, d) => sum + selector(d), 0)
  const absolute = current - previous

  let pct: number
  if (previous === 0) {
    pct = current === 0 ? 0 : current > 0 ? Infinity : -Infinity
  } else {
    pct = (absolute / previous) * 100
  }

  let trend: PeriodDelta["trend"] = "flat"
  if (absolute > 0) trend = "up"
  else if (absolute < 0) trend = "down"

  return { current, previous, absolute, pct, trend }
}

// ===== Sparkline sampling =====

/**
 * Downsample `data` to exactly `width` points using piecewise-constant
 * bucketing. Used to feed a sparkline that has a fixed render width
 * (e.g. 14 cells for a 14-day KPI) regardless of how many days of history
 * are available.
 *
 * Behavior:
 * - When `data.length === width`, returns a copy.
 * - When `data.length > width`, each output point is the **max** of its
 *   bucket (preserves spikes that would otherwise be averaged out).
 * - When `data.length < width`, the series is repeated evenly to fill
 *   the width (so an empty heatmap still draws a baseline).
 * - When `data.length === 0`, returns an array of zeros.
 */
export function sampleForSparkline(data: number[], width: number): number[] {
  if (width <= 0) return []
  if (data.length === 0) return Array.from({ length: width }, () => 0)

  if (data.length === width) return [...data]

  if (data.length > width) {
    const out: number[] = Array.from({ length: width }, () => 0)
    const bucketSize = data.length / width
    for (let i = 0; i < width; i++) {
      const start = Math.floor(i * bucketSize)
      const end = Math.min(data.length, Math.floor((i + 1) * bucketSize))
      let peak = 0
      for (let j = start; j < end; j++) {
        const v = data[j] ?? 0
        if (v > peak) peak = v
      }
      out[i] = peak
    }
    return out
  }

  // data.length < width: repeat with linear interpolation to fill
  const out: number[] = Array.from({ length: width }, () => 0)
  for (let i = 0; i < width; i++) {
    const t = (i / (width - 1)) * (data.length - 1)
    const lo = Math.floor(t)
    const hi = Math.min(data.length - 1, lo + 1)
    const frac = t - lo
    const a = data[lo] ?? 0
    const b = data[hi] ?? 0
    out[i] = a + (b - a) * frac
  }
  return out
}

// ===== Formatting =====

/**
 * Render a `PeriodDelta.pct` value as a compact human string:
 * - 0       → "—"
 * - ±∞      → "new" / "−new" (when current > 0 and previous was 0)
 * - finite  → "↑ 12.3%" / "↓ 4.5%" with one decimal
 *
 * `inverse` flips the color semantics: when `true`, a *decrease* is the
 * "good" direction (e.g. cost reduction, error rate drop). The arrow keeps
 * its up/down direction; the color is decided by the caller.
 */
export function formatDeltaPct(pct: number, inverse = false): { text: string; good: boolean | null } {
  if (!Number.isFinite(pct)) {
    if (pct === 0) return { text: "—", good: null }
    if (pct > 0) return { text: "new", good: inverse ? false : true }
    return { text: "−new", good: inverse ? true : false }
  }
  if (pct === 0) return { text: "—", good: null }

  const arrow = pct > 0 ? "↑" : "↓"
  const abs = Math.abs(pct)
  const text = `${arrow} ${abs.toFixed(1)}%`
  const good = pct > 0 ? !inverse : inverse
  return { text, good }
}

/**
 * Compact integer / short-money format. Mirrors `Intl.NumberFormat` behavior
 * for token counts and similar: 999 → "999", 1.2k → "1.2k", 1.5M → "1.5M".
 */
export function formatCompact(n: number): string {
  if (!Number.isFinite(n)) return "0"
  const abs = Math.abs(n)
  const sign = n < 0 ? "-" : ""
  if (abs < 1_000) return `${sign}${Math.round(abs)}`
  if (abs < 1_000_000) return `${sign}${(abs / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}k`
  if (abs < 1_000_000_000) return `${sign}${(abs / 1_000_000).toFixed(1)}M`
  return `${sign}${(abs / 1_000_000_000).toFixed(2)}B`
}

// ===== Dashboard data shaping =====

export interface DurationHistogramBin {
  label: string
  count: number
  minMs: number
  maxMs: number
}

export interface AnalyticsDialogLayout {
  dialogWidth: number
  contentWidth: number
  sectionWidth: number
  contentHeight: number
  columns: 1 | 2 | 4
  compact: boolean
}

/**
 * Exact width budget for the xlarge analytics dialog.
 *
 * Horizontal chrome: Dialog padding (4) + analytics root padding (6) +
 * scroll border (2) + scroll content padding (4) + scrollbar (1) = 17.
 * Collapsible sections add a left border and one column of padding = 2.
 */
export function computeAnalyticsDialogLayout(terminalWidth: number, terminalHeight: number): AnalyticsDialogLayout {
  const width = Number.isFinite(terminalWidth) ? Math.max(1, Math.floor(terminalWidth)) : 1
  const height = Number.isFinite(terminalHeight) ? Math.max(1, Math.floor(terminalHeight)) : 1
  const dialogWidth = Math.min(116, Math.max(1, width - 8))
  const contentWidth = Math.max(1, dialogWidth - 17)
  const sectionWidth = Math.max(1, contentWidth - 2)
  const contentHeight = Math.max(1, Math.min(Math.max(1, height - 12), Math.max(1, Math.floor(height * 0.82))))
  const columns: AnalyticsDialogLayout["columns"] = contentWidth >= 88 ? 4 : contentWidth >= 44 ? 2 : 1
  return {
    dialogWidth,
    contentWidth,
    sectionWidth,
    contentHeight,
    columns,
    compact: contentWidth < 44,
  }
}

/**
 * Bucket real session durations into stable ranges used by the analytics
 * histogram. The upper bound is exclusive, except for the final open-ended
 * bucket. Zero-duration sessions remain visible in the first bucket.
 */
export function buildDurationHistogram(
  sessions: ReadonlyArray<Pick<SessionStats, "duration">>,
): DurationHistogramBin[] {
  const bins: DurationHistogramBin[] = [
    { label: "<1m", count: 0, minMs: 0, maxMs: 60_000 },
    { label: "1-5m", count: 0, minMs: 60_000, maxMs: 5 * 60_000 },
    { label: "5-15m", count: 0, minMs: 5 * 60_000, maxMs: 15 * 60_000 },
    { label: "15-60m", count: 0, minMs: 15 * 60_000, maxMs: 60 * 60_000 },
    {
      label: "1h+",
      count: 0,
      minMs: 60 * 60_000,
      maxMs: Number.POSITIVE_INFINITY,
    },
  ]

  for (const session of sessions) {
    const duration = Number.isFinite(session.duration) ? Math.max(0, session.duration) : 0
    const bin = bins.find((item) => duration >= item.minMs && duration < item.maxMs)
    if (bin) bin.count++
  }

  return bins
}

/** Call-weighted success rate, so a rarely-used tool cannot skew the total. */
export function weightedToolSuccess(toolUsage: Pick<ToolUsageStats, "tools">): number {
  const calls = toolUsage.tools.reduce((sum, tool) => sum + Math.max(0, tool.count), 0)
  if (calls === 0) return 0
  const weighted = toolUsage.tools.reduce(
    (sum, tool) => sum + Math.max(0, tool.count) * Math.max(0, Math.min(100, tool.successRate)),
    0,
  )
  return weighted / calls
}

/** Compact relative timestamp for the recent-session timeline. */
export function formatRelativeTime(timestamp: number, now = Date.now()): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "unknown"
  const elapsed = Math.max(0, now - timestamp)
  if (elapsed < 60_000) return "now"
  if (elapsed < 60 * 60_000) return `${Math.floor(elapsed / 60_000)}m ago`
  if (elapsed < 24 * 60 * 60_000) return `${Math.floor(elapsed / (60 * 60_000))}h ago`
  if (elapsed < 7 * 24 * 60 * 60_000) return `${Math.floor(elapsed / (24 * 60 * 60_000))}d ago`
  return new Date(timestamp).toISOString().slice(0, 10)
}

// ===== Tab-specific prompts for background agents =====
//
// Each tab in the analytics panel can spawn a background subagent (e.g. the
// `explore`, `researcher`, `code-reviewer`, `debugger` subagents) to dig
// deeper into the data shown on screen. The prompts are pure functions of
// the aggregated stats so they can be unit-tested in isolation; the TUI
// wires up the `session.create` + `session.prompt` calls at runtime.

export type AnalyticsTabId = "overview" | "tokens" | "models" | "tools" | "projects" | "sessions"

const TAB_TITLES: Record<AnalyticsTabId, string> = {
  overview: "Activity overview",
  tokens: "Token usage breakdown",
  models: "Model usage comparison",
  tools: "Tool success / failure analysis",
  projects: "Project activity audit",
  sessions: "Session & background run review",
}

/**
 * Title used for the spawned session. Prepended with "Analytics ·" so the
 * session list / search picks it up as a group.
 */
export function buildTabTitle(tab: AnalyticsTabId): string {
  return `Analytics · ${TAB_TITLES[tab]}`
}

/**
 * Build a tab-specific prompt that grounds the agent in the live data
 * shown on screen. The prompt is intentionally compact — full data dumps
 * would blow the context budget — but includes the headline numbers, the
 * top-N entries that matter most for that tab, and a concrete instruction
 * for what the agent should report back.
 */
export function buildTabPrompt(tab: AnalyticsTabId, stats: import("./analytics-aggregator").AggregatedStats): string {
  const g = stats.global
  const money = (n: number) => `$${n.toFixed(2)}`
  const tokens = formatCompact

  switch (tab) {
    case "overview": {
      const nonCache = g.tokens.input + g.tokens.output + g.tokens.reasoning
      const recent7 = stats.days.slice(-7).reduce((s, d) => s + d.tokens, 0)
      const prev7 = stats.days.slice(-14, -7).reduce((s, d) => s + d.tokens, 0)
      const trend = prev7 > 0 ? (((recent7 - prev7) / prev7) * 100).toFixed(1) : "n/a"
      return [
        "You are reviewing my analytics activity overview.",
        "",
        `• Total sessions: ${g.sessions} (${g.sessions - g.archivedSessions} active, ${g.archivedSessions} archived)`,
        `• Total messages: ${tokens(g.messages)}`,
        `• Total non-cache tokens: ${tokens(nonCache)} (input ${tokens(g.tokens.input)}, output ${tokens(g.tokens.output)}, reasoning ${tokens(g.tokens.reasoning)})`,
        `• Total cost: ${money(g.cost)}`,
        `• 7-day token trend: ${trend}% vs prior week`,
        `• Top providers: ${[...stats.providers.values()]
          .sort((a, b) => b.cost - a.cost)
          .slice(0, 3)
          .map((p) => `${p.providerID} (${money(p.cost)})`)
          .join(", ")}`,
        "",
        "Identify: (1) any anomalies or regressions in the last 7 days, (2) the most expensive category, and (3) one concrete optimization I can apply this week.",
      ].join("\n")
    }
    case "tokens": {
      const last14 = stats.days.slice(-14)
      const peak = last14.reduce((max, d) => (d.tokens > max.tokens ? d : max), last14[0] ?? { tokens: 0, date: "" })
      return [
        "You are reviewing my token usage breakdown.",
        "",
        `• Cost per 1k tokens: $${g.efficiency.costPer1kTokens.toFixed(4)}`,
        `• Cost per session: ${money(g.efficiency.costPerSession)}`,
        `• Avg tokens per session: ${tokens(g.efficiency.avgTokensPerSession)}`,
        `• Avg cost per day: ${money(g.efficiency.avgCostPerDay)}`,
        `• Peak day in last 14: ${peak.date} (${tokens(peak.tokens)} tokens)`,
        `• Cache savings: read ${tokens(g.tokens.cacheRead)}, write ${tokens(g.tokens.cacheWrite)}`,
        "",
        "Suggest: (1) ways to reduce input-token cost, (2) whether the cache hit rate is healthy, and (3) which day was anomalous and why.",
      ].join("\n")
    }
    case "models": {
      const top = stats.models.slice(0, 5).map((m) => {
        const total = m.tokens.input + m.tokens.output + m.tokens.reasoning
        return `${m.modelID} (${m.providerID}): ${tokens(total)} tokens, ${money(m.cost)}, ${m.messages} msgs`
      })
      return [
        "You are reviewing my model usage comparison.",
        "",
        "Top models by token volume:",
        ...top.map((line) => `  • ${line}`),
        "",
        "Recommend: (1) which model offers the best cost/quality trade-off for routine work, (2) any model that is underused despite good fit, and (3) whether I'm over-spending on any premium tier.",
      ].join("\n")
    }
    case "tools": {
      const rows = stats.toolUsage.mostUsed.slice(0, 8).map((t) => {
        return `${t.name}: ${t.count} calls, ${t.successRate.toFixed(0)}% success`
      })
      const failing = stats.toolUsage.mostUsed.filter((t) => t.successRate < 70)
      return [
        "You are reviewing my tool success / failure analysis.",
        "",
        `• Total tool calls: ${stats.toolUsage.total}`,
        `• Tools below 70% success: ${failing.length === 0 ? "none" : failing.map((f) => f.name).join(", ")}`,
        "",
        "Top tools by usage:",
        ...rows.map((line) => `  • ${line}`),
        "",
        "Identify: (1) which failing tools are blocking my work, (2) any tool I should stop using or replace, and (3) overall reliability of my workflow.",
      ].join("\n")
    }
    case "projects": {
      const rows = stats.projects.slice(0, 8).map((p) => {
        return `${p.name}: ${p.sessionCount} sessions, ${tokens(p.totalTokens)} tokens, ${money(p.totalCost)} (vcs=${p.vcs})`
      })
      const dormant = stats.projects.filter((p) => Date.now() - p.lastActive > 30 * 86_400_000).length
      return [
        "You are reviewing my project activity audit.",
        "",
        `• Total projects: ${stats.projects.length} (${dormant} dormant >30d)`,
        "",
        "Top projects by activity:",
        ...rows.map((line) => `  • ${line}`),
        "",
        "Recommend: (1) which dormant project is worth reviving, (2) any project that is mis-attributed, and (3) overall distribution of effort across my work.",
      ].join("\n")
    }
    case "sessions": {
      const top = stats.sessions.slice(0, 5).map((s) => {
        const total = s.tokens.input + s.tokens.output + s.tokens.reasoning
        return `“${s.title.slice(0, 40)}”: ${tokens(total)} tokens, ${money(s.cost)}`
      })
      const bg = stats.backgroundRuns
      return [
        "You are reviewing my recent session & background-run activity.",
        "",
        `• Sessions: ${g.sessions} total (${g.sessions - g.archivedSessions} active)`,
        `• Background runs: ${bg.total} (${bg.completed} ok, ${bg.error} errored, ${bg.cancelled} cancelled, ${bg.successRate.toFixed(0)}% success)`,
        `• Avg background run duration: ${Math.round(bg.avgDuration / 1000)}s`,
        "",
        "Top sessions by token cost:",
        ...top.map((line) => `  • ${line}`),
        "",
        "Highlight: (1) any expensive session that didn't pay off, (2) the failure pattern in background runs, and (3) one way to reduce session cost without losing quality.",
      ].join("\n")
    }
  }
}
