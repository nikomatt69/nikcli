import { TextAttributes, RGBA } from "@opentui/core"
import { useTheme, type Theme } from "../context/theme"
import { useSync } from "@tui/context/sync"
import { useSDK } from "@tui/context/sdk"
import { useAnalytics } from "../context/analytics"
import { useKeyboard } from "@opentui/solid"
import { For, Show, createSignal, createMemo, onMount, type ParentProps } from "solid-js"
import {
  aggregateAnalytics,
  mergeWithHistorical,
  mergeSessionsFromApi,
  augmentAggregatedStatsFromPersistedSessions,
  buildActivityGrid,
  computeActivityStats,
  type AggregatedStats,
} from "../util/analytics-aggregator"
import { useDialog } from "@tui/ui/dialog"
import {
  BrailleLineChart,
  BrailleAreaChart,
  StackedBarChartV2,
  HBarPrecision,
  KPICard,
  ModelCard,
  RankedBarList,
  getChartColors,
} from "./chart-braille-line"
import {
  periodDelta,
  sampleForSparkline,
  formatCompact,
  buildTabPrompt,
  buildTabTitle,
  type AnalyticsTabId,
} from "../util/analytics-utils"
import { useToast } from "@tui/ui/toast"
import { useLocal } from "@tui/context/local"

// ===== Color utilities =====

function colorToString(color: string | { r: number; g: number; b: number; a?: number }): string {
  if (typeof color === "string") return color
  const { r, g, b, a = 1 } = color
  if (a === 1) {
    return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`
  }
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}${Math.round(
    a * 255,
  )
    .toString(16)
    .padStart(2, "0")}`
}

// Format helpers
const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
})

function formatTokens(n: number): string {
  if (n < 1_000) return n.toString()
  if (n < 1_000_000) return `${(n / 1_000).toFixed(1)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}

function formatDuration(ms: number): string {
  if (ms < 60000) return `${Math.round(ms / 1000)}s`
  if (ms < 3600000) return `${Math.round(ms / 60000)}m`
  return `${(ms / 3600000).toFixed(1)}h`
}

// Box drawing characters
const BOX = {
  topLeft: "┌",
  topRight: "┐",
  bottomLeft: "└",
  bottomRight: "┘",
  horizontal: "─",
  vertical: "│",
  cross: "┼",
  teeDown: "┬",
} as const

// ===== MAIN DIALOG =====

type TabId = "overview" | "tokens" | "models" | "tools" | "projects" | "sessions"

const TABS: { id: TabId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "tokens", label: "Tokens" },
  { id: "models", label: "Models" },
  { id: "tools", label: "Tools" },
  { id: "projects", label: "Projects" },
  { id: "sessions", label: "Sessions" },
]

export function DialogAnalytics(_props: { onClose: () => void }) {
  const { theme } = useTheme()
  const sync = useSync()
  const sdk = useSDK()
  const analyticsCtx = useAnalytics()
  const dialog = useDialog()

  const [loading, setLoading] = createSignal(true)
  const [stats, setStats] = createSignal<AggregatedStats | null>(null)
  const [activeTab, setActiveTab] = createSignal<TabId>("overview")

  onMount(async () => {
    dialog.setSize("xlarge")
    await loadAnalytics()
  })

  async function waitForSyncBootstrap() {
    const started = Date.now()
    const maxWait = 15_000
    while (Date.now() - started < maxWait) {
      if (sync.status === "complete") return
      // `session.list` runs in the non-blocking batch; `partial` can persist if another
      // sub-request hangs — proceed once we have an index or after a short grace period.
      if (sync.ready && sync.data.session.length > 0) return
      if (sync.ready && Date.now() - started > 2_500) return
      await new Promise((r) => setTimeout(r, 40))
    }
  }

  async function loadAnalytics() {
    setLoading(true)
    try {
      await waitForSyncBootstrap()
      const liveStats = aggregateAnalytics({
        session: sync.data.session,
        message: sync.data.message,
        part: sync.data.part,
        todo: sync.data.todo,
        workspaceList: sync.data.workspaceList,
        background_job: sync.data.background_job,
      })

      try {
        if (sdk.url) {
          const gotHistorical = await analyticsCtx.refresh()
          let stats: AggregatedStats = gotHistorical
            ? mergeWithHistorical(liveStats, {
                global: analyticsCtx.global(),
                daily: analyticsCtx.daily(),
              })
            : liveStats
          const persistedSessions = analyticsCtx.sessions()
          if (persistedSessions.length > 0) {
            stats = {
              ...stats,
              sessions: mergeSessionsFromApi(stats.sessions, persistedSessions),
            }
            stats = augmentAggregatedStatsFromPersistedSessions(stats, persistedSessions)
          }
          setStats(stats)
        } else {
          setStats(liveStats)
        }
      } catch {
        setStats(liveStats)
      }
    } catch (e) {
      console.error("Failed to load analytics:", e)
    } finally {
      setLoading(false)
    }
  }

  // Computed values
  const last14Days = createMemo(() => stats()?.days.slice(-14) ?? [])
  const last30Days = createMemo(() => stats()?.days.slice(-30) ?? [])

  // Tab navigation
  const tabIndex = createMemo(() => TABS.findIndex((t) => t.id === activeTab()))
  const prevTab = () => {
    const idx = tabIndex()
    if (idx > 0) setActiveTab(TABS[idx - 1]!.id)
  }
  const nextTab = () => {
    const idx = tabIndex()
    if (idx < TABS.length - 1) setActiveTab(TABS[idx + 1]!.id)
  }

  useKeyboard((evt) => {
    if (evt.name === "arrow-left") prevTab()
    else if (evt.name === "arrow-right") nextTab()
  })

  return (
    <box paddingLeft={3} paddingRight={3} gap={2} paddingBottom={1}>
      {/* Header */}
      <box flexDirection="row" justifyContent="space-between" alignItems="center">
        <text fg={theme.accent} attributes={TextAttributes.BOLD}>
          ◈ ANALYTICS
        </text>
        <text fg={theme.textMuted}>
          {activeTab() === "overview"
            ? "←→ tabs · ↑↓ focus · space toggle · esc close"
            : "←→ or click tabs · esc close"}
        </text>
      </box>

      <Show when={loading()}>
        <text fg={theme.textMuted}>Loading analytics...</text>
      </Show>

      <Show when={!loading() && stats()}>
        {/* Compact tab dropdown — single inline element that cycles on
            click, mirroring the metric switcher in the Overview tab. Saves
            a horizontal row regardless of how many tabs are added later
            and prevents overflow on narrow terminals. */}
        <box flexDirection="row" gap={1} alignItems="center">
          <text fg={theme.textMuted} wrapMode="none">
            Tab:
          </text>
          <box
            flexDirection="row"
            gap={1}
            alignItems="baseline"
            backgroundColor={theme.backgroundElement}
            paddingLeft={1}
            paddingRight={1}
            onMouseUp={() => nextTab()}
          >
            <text fg={theme.primary} attributes={TextAttributes.BOLD} wrapMode="none">
              {TABS.find((t) => t.id === activeTab())?.label}
            </text>
            <text fg={theme.textMuted} wrapMode="none">
              ▾
            </text>
          </box>
          <text fg={theme.textMuted} wrapMode="none">
            ({tabIndex() + 1}/{TABS.length} · ←/→ to switch · click to next)
          </text>
        </box>

        <text fg={theme.border} wrapMode="none">
          {BOX.horizontal.repeat(60)}
        </text>

        {/* Background agent bar — always visible, prompt is built from the
            active tab. Lets the user dig deeper into the data on screen
            without leaving the panel. */}

        {/* Tab Content */}
        <Show when={activeTab() === "overview"}>
          <OverviewTab stats={stats()!} last30Days={last30Days()} />
        </Show>
        <Show when={activeTab() === "tokens"}>
          <TokensTab stats={stats()!} last14Days={last14Days()} />
        </Show>
        <Show when={activeTab() === "models"}>
          <ModelsTab stats={stats()!} />
        </Show>
        <Show when={activeTab() === "tools"}>
          <ToolsTab stats={stats()!} />
        </Show>
        <Show when={activeTab() === "projects"}>
          <ProjectsTab stats={stats()!} />
        </Show>
        <Show when={activeTab() === "sessions"}>
          <SessionsTab stats={stats()!} />
        </Show>
      </Show>
    </box>
  )
}

// ===== SHARED UI =====

function LegendDot(props: { color: ReturnType<typeof getChartColors>["input"]; label: string }) {
  const { theme } = useTheme()
  return (
    <box flexDirection="row" gap={1} alignItems="center">
      <text fg={props.color} wrapMode="none">
        ■
      </text>
      <text fg={theme.textMuted} wrapMode="none">
        {props.label}
      </text>
    </box>
  )
}

function CollapsibleSection(
  props: ParentProps<{
    title: string
    open: boolean
    focused?: boolean
    hint?: string
    onToggle: () => void
  }>,
) {
  const { theme } = useTheme()
  return (
    <box flexDirection="column" gap={1}>
      <box
        flexDirection="row"
        gap={1}
        alignItems="center"
        backgroundColor={props.focused ? theme.backgroundElement : undefined}
        onMouseUp={() => props.onToggle()}
      >
        <text fg={props.focused ? theme.primary : theme.textMuted} wrapMode="none">
          {props.open ? "▾" : "▶"}
        </text>
        <text fg={props.focused ? theme.primary : theme.text} attributes={TextAttributes.BOLD} wrapMode="none">
          {props.title}
        </text>
        <Show when={props.hint}>
          <text fg={theme.textMuted} wrapMode="none">
            {props.hint}
          </text>
        </Show>
      </box>
      <Show when={props.open}>
        <box flexDirection="column" gap={1} paddingLeft={2}>
          {props.children}
        </box>
      </Show>
    </box>
  )
}

// Keyboard-navigable collapsible group: ↑↓ moves focus, space/enter toggles the
// focused section. `extraKeys` lets a tab handle section-specific keys (returns
// true when handled). Mounted one-at-a-time per tab, so handlers never overlap.
function useCollapsibleGroup<T extends string>(
  sections: readonly T[],
  extraKeys?: (evt: { name?: string; preventDefault?: () => void }, focusedId: T) => boolean,
) {
  const [open, setOpen] = createSignal<Record<T, boolean>>(
    Object.fromEntries(sections.map((s) => [s, true])) as Record<T, boolean>,
  )
  const [focus, setFocus] = createSignal(0)
  const toggle = (id: T) => setOpen((o) => ({ ...o, [id]: !o[id] }))
  const focused = (id: T) => sections[focus()] === id

  useKeyboard((evt) => {
    if (evt.name === "up" || evt.name === "arrow-up") {
      evt.preventDefault?.()
      setFocus((f) => Math.max(0, f - 1))
    } else if (evt.name === "down" || evt.name === "arrow-down") {
      evt.preventDefault?.()
      setFocus((f) => Math.min(sections.length - 1, f + 1))
    } else if (evt.name === "space" || evt.name === " " || evt.name === "return") {
      evt.preventDefault?.()
      toggle(sections[focus()]!)
    } else {
      extraKeys?.(evt, sections[focus()]!)
    }
  })

  return { open, toggle, focused }
}

// ===== Background Agent Bar =====
//
// Always-visible bar that lets the user spawn a subagent on the currently
// active tab. The agent dropdown cycles through the most useful
// subagents for analytics work (explore / fast-explore / researcher /
// code-reviewer / debugger); the Run button creates a new session, sends
// the tab-specific prompt built by `buildTabPrompt`, and surfaces the
// outcome via toast. Keeping it at the dialog level (rather than per
// tab) keeps the panel from overflowing: the bar is one line tall
// regardless of how many tabs exist or what data they show.

// ===== TAB COMPONENTS =====

const OVERVIEW_SECTIONS = ["activity", "trend", "daily", "providers"] as const

// ===== Activity Heatmap =====
//
// GitHub-style contribution graph: 7 rows (Mon..Sun) × N weeks. Used as the
// first collapsible section in the Overview tab. Renders four headline KPIs
// (Longest streak, Active days, Avg/day, Total), a 5-step quantized legend
// (GitHub-style), and the cell grid with sparse Mon/Wed/Fri day labels and
// month labels on top.
//
// The previous version interpolated continuously between `backgroundElement`
// and `primary`, which produced a near-black ramp on dark themes and made the
// grid indistinguishable from the terminal background. The new design uses a
// 5-step discrete palette with a *visible* empty level (borderSubtle on dark
// themes, just dim gray) and saturated stops, so every cell communicates
// either "no activity" or one of 4 intensity levels at a glance.

function lerpRgba(a: RGBA, b: RGBA, t: number): RGBA {
  return RGBA.fromInts(
    Math.round(a.r + (b.r - a.r) * t),
    Math.round(a.g + (b.g - a.g) * t),
    Math.round(a.b + (b.b - a.b) * t),
    255,
  )
}

/**
 * 5-step activity palette (GitHub-style): [empty, low, mid, high, max].
 *
 * `empty` is picked to be *visibly distinct* from the terminal background on
 * any theme, falling back to a dim gray when `backgroundElement` would be
 * indistinguishable. Steps 1..4 are lerps of `primary` with 30/55/80/100%
 * intensity, so each level reads as a distinct shade even in 16-color
 * terminals (since the max stop is fully saturated).
 */
function activityPalette(theme: Theme): [RGBA, RGBA, RGBA, RGBA, RGBA] {
  // Make the empty level ~20% brighter than backgroundElement so empty cells
  // form a visible grid. backgroundElement alone (≈25/255 on a black bg) is
  // invisible against most terminal backgrounds.
  const base = theme.backgroundElement
  const bright = lerpRgba(base, theme.text, 0.18)
  return [
    bright, // 0 — empty
    lerpRgba(bright, theme.primary, 0.35),
    lerpRgba(bright, theme.primary, 0.6),
    lerpRgba(bright, theme.primary, 0.85),
    theme.primary,
  ]
}

/** Map a daily value to one of 5 buckets. Empty cells → bucket 0. */
function activityBucket(value: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (value <= 0 || max <= 0) return 0
  const t = value / max
  if (t <= 0.25) return 1
  if (t <= 0.5) return 2
  if (t <= 0.75) return 3
  return 4
}

function ActivityStat(props: { label: string; value: string; hint?: string }) {
  const { theme } = useTheme()
  return (
    <box flexDirection="column" gap={0}>
      <text fg={theme.textMuted} wrapMode="none">
        {props.label}
      </text>
      <box flexDirection="row" gap={1} alignItems="baseline">
        <text fg={theme.text} attributes={TextAttributes.BOLD} wrapMode="none">
          {props.value}
        </text>
        <Show when={props.hint}>
          <text fg={theme.textMuted} wrapMode="none">
            {props.hint}
          </text>
        </Show>
      </box>
    </box>
  )
}

function ActivityHeatmap(props: { stats: AggregatedStats }) {
  const { theme } = useTheme()

  // Metric switcher: 0=tokens, 1=cost, 2=messages. Lets the user pivot
  // the heatmap between consumption (tokens), spending (cost) and engagement
  // (messages) without leaving the panel. The numeric KPI row re-binds to
  // the active metric so headline numbers never disagree with the grid.
  const [metricIdx, setMetricIdx] = createSignal<0 | 1 | 2>(0)
  const metric = createMemo<"tokens" | "cost" | "messages">(() =>
    metricIdx() === 1 ? "cost" : metricIdx() === 2 ? "messages" : "tokens",
  )
  const metricLabel = () => (metric() === "cost" ? "cost" : metric() === "messages" ? "messages" : "tokens")
  const metricSelector = (d: (typeof props.stats.days)[number]): number =>
    metric() === "cost" ? d.cost : metric() === "messages" ? d.messages : d.tokens
  const cycleMetric = () => setMetricIdx((m) => ((m + 1) % 3) as 0 | 1 | 2)

  const grid = createMemo(() => buildActivityGrid(props.stats.days, 365, metricSelector))
  const stats = createMemo(() => computeActivityStats(props.stats.days, metricSelector))

  const palette = createMemo(() => activityPalette(theme))

  // 5-stop discrete legend — same palette as the cells, so each step
  // corresponds to a visible cell tone.
  const legendStops = createMemo(() => palette())

  // 1-letter month labels (J F M A M J J A S O N D) align 1:1 with the
  // 1-char-wide cell columns below. Compact and unambiguous on any width.
  const monthInitial = (name: string) => name.charAt(0)

  // Day-of-week labels (Mon, Wed, Fri) — short form on the gutter, matched
  // to the row index. Slightly more legible than single letters without
  // making the gutter too wide.
  const dowLabels = ["Mon", "", "Wed", "", "Fri", "", ""] as const

  // Pre-compute cell rows: 7 rows × N weeks of bucket indices (for rendering
  // + for the legend swatch). Avoids re-running activityBucket in JSX.
  const cellBuckets = createMemo(() => {
    const g = grid()
    return g.cells.map((row) => row.map((v) => activityBucket(v, g.maxValue)))
  })

  return (
    <box flexDirection="column" gap={1}>
      {/* KPI row: Longest streak · Active days · Avg/day · Total · metric switcher */}
      <box flexDirection="row" gap={4} flexWrap="wrap">
        <ActivityStat
          label="Longest streak"
          value={String(stats().longestStreak)}
          hint={stats().longestStreak === 1 ? "day" : "days"}
        />
        <ActivityStat label="Active days" value={`${stats().activeDays} / ${stats().totalDays}`} />
        <ActivityStat
          label="Avg / day"
          value={metric() === "cost" ? money.format(stats().avgPerActiveDay) : formatTokens(stats().avgPerActiveDay)}
        />
        <ActivityStat
          label="Total"
          value={metric() === "cost" ? money.format(stats().total) : formatTokens(stats().total)}
        />
        {/* Click to cycle tokens → cost → messages → tokens. */}
        <box
          flexDirection="row"
          gap={1}
          alignItems="baseline"
          backgroundColor={theme.backgroundElement}
          paddingLeft={1}
          paddingRight={1}
          onMouseUp={() => cycleMetric()}
        >
          <text fg={theme.textMuted} wrapMode="none">
            metric:
          </text>
          <text fg={theme.primary} attributes={TextAttributes.BOLD} wrapMode="none">
            {metricLabel()}
          </text>
          <text fg={theme.textMuted} wrapMode="none">
            [tap to cycle]
          </text>
        </box>
      </box>

      <Show
        when={grid().weeks > 0 && stats().totalDays > 0}
        fallback={<text fg={theme.textMuted}>No activity data in the last year</text>}
      >
        {/* Grid: dow gutter + (month labels + 7 rows of cells) */}
        <box flexDirection="row" gap={1}>
          <box flexDirection="column" gap={0} flexShrink={0}>
            {/* Spacer to align with the month-labels row above the cells */}
            <text> </text>
            <For each={dowLabels}>
              {(label) => (
                <text fg={theme.textMuted} wrapMode="none">
                  {(label || " ").padEnd(3, " ")}
                </text>
              )}
            </For>
          </box>
          <box flexDirection="column" gap={0}>
            {/* Month labels: 1 initial per week column, aligning 1:1 with the
                1-char cell columns below. */}
            <box flexDirection="row" gap={0}>
              <For each={Array.from({ length: grid().weeks })}>
                {(_, col) => {
                  const label = createMemo(() => {
                    const m = grid().monthLabels.find((l) => l.col === col())
                    return m ? monthInitial(m.label) : ""
                  })
                  return (
                    <text fg={theme.textMuted} width={1} wrapMode="none">
                      {label() || " "}
                    </text>
                  )
                }}
              </For>
            </box>
            {/* 7 rows of cells. Each box uses backgroundColor from the
                quantized palette so adjacent cells of the same intensity form
                a continuous block, while intensity changes are crisp. */}
            <For each={cellBuckets()}>
              {(row) => (
                <box flexDirection="row" gap={0}>
                  <For each={row}>
                    {(bucket) => (
                      <box backgroundColor={palette()[bucket]} flexShrink={0}>
                        <text> </text>
                      </box>
                    )}
                  </For>
                </box>
              )}
            </For>
          </box>
        </box>

        {/* Legend: Less ─ ▢▢▢▢▢ ─ More */}
        <box flexDirection="row" gap={1} alignItems="center">
          <text fg={theme.textMuted} wrapMode="none">
            Less
          </text>
          <For each={legendStops()}>
            {(c) => (
              <box backgroundColor={c} flexShrink={0}>
                <text> </text>
              </box>
            )}
          </For>
          <text fg={theme.textMuted} wrapMode="none">
            More
          </text>
          <text fg={theme.border} wrapMode="none">
            {" "}
            ·{" "}
          </text>
          <text fg={theme.textMuted} wrapMode="none">
            peak {metric() === "cost" ? money.format(grid().maxValue) : formatTokens(grid().maxValue)} {metricLabel()}
            /day
          </text>
        </box>
      </Show>
    </box>
  )
}

function OverviewTab(props: { stats: AggregatedStats; last30Days: typeof props.stats.days }) {
  const { theme } = useTheme()
  const g = () => props.stats.global
  const viz = () => getChartColors(theme)

  const [dailyRange, setDailyRange] = createSignal<7 | 14 | 30>(7)
  const cycleRange = () => setDailyRange((r) => (r === 7 ? 14 : r === 14 ? 30 : 7))
  const { open, toggle, focused } = useCollapsibleGroup(OVERVIEW_SECTIONS, (evt, id) => {
    if (id === "daily" && evt.name === "r") {
      evt.preventDefault?.()
      cycleRange()
      return true
    }
    return false
  })
  const dailyDays = createMemo(() => props.last30Days.slice(-dailyRange()))
  const dailyMax = createMemo(() => Math.max(1, ...dailyDays().map((d) => d.tokens)))

  // Per-KPI sparklines: 14 cells so the line spans roughly 2 weeks.
  // `sampleForSparkline` down/upsamples to width regardless of history length.
  const sessionsSpark = createMemo(() =>
    sampleForSparkline(
      props.last30Days.map((d) => d.sessions),
      14,
    ),
  )
  const messagesSpark = createMemo(() =>
    sampleForSparkline(
      props.last30Days.map((d) => d.messages),
      14,
    ),
  )
  const costSpark = createMemo(() =>
    sampleForSparkline(
      props.last30Days.map((d) => d.cost),
      14,
    ),
  )
  const tokensSpark = createMemo(() =>
    sampleForSparkline(
      props.last30Days.map((d) => d.tokens),
      14,
    ),
  )

  // 7-day deltas: compare the most recent 7 days against the prior 7.
  // `deltaInverse: true` for cost (lower is better).
  const sessionsDelta = createMemo(() => periodDelta(props.last30Days, 7, (d) => d.sessions))
  const messagesDelta = createMemo(() => periodDelta(props.last30Days, 7, (d) => d.messages))
  const costDelta = createMemo(() => periodDelta(props.last30Days, 7, (d) => d.cost))
  const tokensDelta = createMemo(() => periodDelta(props.last30Days, 7, (d) => d.tokens))

  return (
    <box flexDirection="column" gap={2}>
      {/* KPI Cards — each carries a 14-cell sparkline + 7-day delta. */}
      <box flexDirection="row" gap={2}>
        <KPICard
          label="SESSIONS"
          value={g().sessions.toString()}
          color={viz().series[0]!}
          subtitle={`${g().sessions - g().archivedSessions} active`}
          sparkline={sessionsSpark()}
          delta={{ pct: sessionsDelta().pct }}
        />
        <KPICard
          label="MESSAGES"
          value={formatTokens(g().messages)}
          color={viz().series[1]!}
          sparkline={messagesSpark()}
          delta={{ pct: messagesDelta().pct }}
        />
        <KPICard
          label="COST"
          value={money.format(g().cost)}
          color={viz().series[2]!}
          subtitle={`$${g().efficiency.costPer1kTokens.toFixed(4)}/1k tokens`}
          sparkline={costSpark()}
          delta={{ pct: costDelta().pct, inverse: true }}
        />
        <KPICard
          label="TOKENS"
          value={formatTokens(g().tokens.input + g().tokens.output + g().tokens.reasoning)}
          color={viz().series[3]!}
          subtitle={`in:${formatTokens(g().tokens.input)} out:${formatTokens(g().tokens.output)}`}
          sparkline={tokensSpark()}
          delta={{ pct: tokensDelta().pct }}
        />
      </box>

      {/* Activity Heatmap (GitHub-style) */}
      <CollapsibleSection
        title="Activity"
        hint={`(last ${Math.min(365, props.stats.days.length)} days)`}
        open={open().activity}
        focused={focused("activity")}
        onToggle={() => toggle("activity")}
      >
        <ActivityHeatmap stats={props.stats} />
      </CollapsibleSection>

      {/* Braille Line Chart - Token Usage Over Time */}
      <Show when={props.last30Days.length > 0}>
        <CollapsibleSection
          title="Token Usage Over Time"
          hint="(30 days)"
          open={open().trend}
          focused={focused("trend")}
          onToggle={() => toggle("trend")}
        >
          <BrailleLineChart
            series={[
              {
                label: "Input",
                data: props.last30Days.map((d) => d.input),
                color: viz().input,
              },
              {
                label: "Output",
                data: props.last30Days.map((d) => d.output),
                color: viz().output,
              },
              {
                label: "Cache",
                data: props.last30Days.map((d) => d.cacheRead + d.cacheWrite),
                color: viz().cache,
              },
            ]}
            width={60}
            height={8}
            showGrid
            showLegend
            showAxis
            yFormat={formatTokens}
          />
        </CollapsibleSection>
      </Show>

      {/* Daily Stacked Bar Chart */}
      <Show when={props.last30Days.length > 0}>
        <CollapsibleSection
          title="Daily Token Breakdown"
          hint={`(last ${dailyRange()} days · r to cycle)`}
          open={open().daily}
          focused={focused("daily")}
          onToggle={() => toggle("daily")}
        >
          <For each={dailyDays()}>
            {(day) => {
              const isPeak = () => day.tokens > 0 && day.tokens === dailyMax()
              return (
                <box flexDirection="row" gap={2} alignItems="center">
                  <text
                    fg={isPeak() ? theme.primary : theme.textMuted}
                    attributes={isPeak() ? TextAttributes.BOLD : undefined}
                    width={6}
                    wrapMode="none"
                  >
                    {day.date.slice(5)}
                  </text>
                  <StackedBarChartV2
                    segments={[
                      { label: "Input", value: day.input, color: viz().input },
                      {
                        label: "Output",
                        value: day.output,
                        color: viz().output,
                      },
                      {
                        label: "Cache",
                        value: day.cacheRead + day.cacheWrite,
                        color: viz().cache,
                      },
                      {
                        label: "Reason",
                        value: day.reasoning,
                        color: viz().reasoning,
                      },
                    ]}
                    width={30}
                    showLabels={false}
                  />
                  <text fg={theme.textMuted} width={7} wrapMode="none">
                    {formatTokens(day.tokens)}
                  </text>
                  <text fg={theme.success} wrapMode="none">
                    {day.cost > 0 ? money.format(day.cost) : ""}
                  </text>
                </box>
              )
            }}
          </For>
          <Show when={dailyDays().every((d) => d.tokens === 0)}>
            <text fg={theme.textMuted}>No usage in this range</text>
          </Show>
          {/* Legend + range control */}
          <box flexDirection="row" gap={3} alignItems="center">
            <LegendDot color={viz().input} label="Input" />
            <LegendDot color={viz().output} label="Output" />
            <LegendDot color={viz().cache} label="Cache" />
            <LegendDot color={viz().reasoning} label="Reason" />
            <text fg={theme.textMuted} onMouseUp={() => cycleRange()} wrapMode="none">
              [{dailyRange()}d ⟳]
            </text>
          </box>
        </CollapsibleSection>
      </Show>

      {/* Provider Summary */}
      <CollapsibleSection
        title="Top Providers"
        hint={`(${props.stats.providers.size})`}
        open={open().providers}
        focused={focused("providers")}
        onToggle={() => toggle("providers")}
      >
        <For each={Array.from(props.stats.providers.values()).slice(0, 5)}>
          {(prov) => (
            <box flexDirection="row" gap={2} alignItems="center">
              <text fg={theme.primary} width={12} wrapMode="none">
                {prov.providerID}
              </text>
              <text fg={theme.textMuted} width={14} wrapMode="none">
                {prov.sessions}s / {prov.messages}m
              </text>
              <text fg={theme.success} wrapMode="none">
                {money.format(prov.cost)}
              </text>
            </box>
          )}
        </For>
        <Show when={props.stats.providers.size === 0}>
          <text fg={theme.textMuted}>No provider data</text>
        </Show>
      </CollapsibleSection>
    </box>
  )
}

const TOKENS_SECTIONS = ["breakdown", "trend", "efficiency"] as const

function TokensTab(props: { stats: AggregatedStats; last14Days: typeof props.stats.days }) {
  const { theme } = useTheme()
  const viz = () => getChartColors(theme)
  const g = () => props.stats.global
  const tokens = () => g().tokens
  const total = createMemo(() => tokens().input + tokens().output + tokens().reasoning)
  const totalWithCache = createMemo(() => total() + tokens().cacheRead + tokens().cacheWrite)
  const { open, toggle, focused } = useCollapsibleGroup(TOKENS_SECTIONS)

  return (
    <box flexDirection="column" gap={2}>
      {/* Token Breakdown Bars with 8-level precision */}
      <CollapsibleSection
        title="Token Breakdown"
        open={open().breakdown}
        focused={focused("breakdown")}
        onToggle={() => toggle("breakdown")}
      >
        <HBarPrecision label="input" value={tokens().input} max={total()} width={25} color={viz().input} showPct />
        <HBarPrecision label="output" value={tokens().output} max={total()} width={25} color={viz().output} showPct />
        <HBarPrecision
          label="reasoning"
          value={tokens().reasoning}
          max={total()}
          width={25}
          color={viz().reasoning}
          showPct
        />
        <HBarPrecision
          label="cache-read"
          value={tokens().cacheRead}
          max={totalWithCache()}
          width={25}
          color={viz().cache}
          showPct
        />
        <HBarPrecision
          label="cache-write"
          value={tokens().cacheWrite}
          max={totalWithCache()}
          width={25}
          color={viz().cacheWrite}
          showPct
        />
      </CollapsibleSection>

      {/* Braille Area Chart for token trend */}
      <Show when={props.last14Days.length > 0}>
        <CollapsibleSection
          title="14-Day Token Trend"
          open={open().trend}
          focused={focused("trend")}
          onToggle={() => toggle("trend")}
        >
          <BrailleAreaChart data={props.last14Days.map((d) => d.tokens)} width={50} height={4} color={viz().input} />
        </CollapsibleSection>
      </Show>

      {/* Efficiency Metrics */}
      <CollapsibleSection
        title="Efficiency Metrics"
        open={open().efficiency}
        focused={focused("efficiency")}
        onToggle={() => toggle("efficiency")}
      >
        <box flexDirection="row" gap={3}>
          <box flexDirection="column" gap={0}>
            <text fg={theme.textMuted}>Cost/1K tokens</text>
            <text fg={colorToString(theme.success)} attributes={TextAttributes.BOLD}>
              ${g().efficiency.costPer1kTokens.toFixed(4)}
            </text>
          </box>
          <box flexDirection="column" gap={0}>
            <text fg={theme.textMuted}>Cost/session</text>
            <text fg={colorToString(theme.success)} attributes={TextAttributes.BOLD}>
              {money.format(g().efficiency.costPerSession)}
            </text>
          </box>
          <box flexDirection="column" gap={0}>
            <text fg={theme.textMuted}>Tokens/session</text>
            <text fg={viz().input} attributes={TextAttributes.BOLD}>
              {formatTokens(g().efficiency.avgTokensPerSession)}
            </text>
          </box>
          <box flexDirection="column" gap={0}>
            <text fg={theme.textMuted}>Avg cost/day</text>
            <text fg={colorToString(theme.warning)} attributes={TextAttributes.BOLD}>
              {money.format(g().efficiency.avgCostPerDay)}
            </text>
          </box>
        </box>
      </CollapsibleSection>
    </box>
  )
}

function ModelsTab(props: { stats: AggregatedStats }) {
  const { theme } = useTheme()
  const viz = () => getChartColors(theme)
  const models = createMemo(() => props.stats.models.slice(0, 8))
  const maxTokens = createMemo(() => {
    const m = models()
    if (m.length === 0) return 1
    return Math.max(...m.map((mod) => mod.tokens.input + mod.tokens.output), 1)
  })

  // Per-model 14-day daily tokens used to power the inline trend sparkline.
  // Sum input+output+reasoning across all days for this model.
  const modelSparkline = (modelKey: string, modelID: string) => {
    const series: number[] = props.stats.days.map((d) => {
      const row = d.models.get(modelKey) ?? d.models.get(`${d.date}#${modelID}`)
      return row ? row.tokens : 0
    })
    return sampleForSparkline(series, 14)
  }

  return (
    <box flexDirection="column" gap={1}>
      <text fg={theme.text} attributes={TextAttributes.BOLD}>
        Model Usage ({props.stats.models.length} models)
      </text>

      <For each={models()}>
        {(model) => (
          <ModelCard
            name={model.modelID}
            provider={model.providerID}
            requests={model.messages}
            inputTokens={model.tokens.input}
            outputTokens={model.tokens.output}
            maxTokens={maxTokens()}
            color={viz().series[4]!}
          />
        )}
      </For>

      <Show when={props.stats.models.length === 0}>
        <text fg={theme.textMuted}>No model usage data</text>
      </Show>

      {/* Compact aggregate view: 14-day daily usage per top model, with
          input vs output split bars so the input/output ratio is visible
          at a glance (per-model). */}
      <Show when={models().length > 0}>
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          Daily Usage Split
        </text>
        <For each={models()}>
          {(model) => {
            const modelKey = `${model.providerID}/${model.modelID}`
            const spark = modelSparkline(modelKey, model.modelID)
            const totalNonCache = model.tokens.input + model.tokens.output + model.tokens.reasoning
            const inShare = totalNonCache > 0 ? model.tokens.input / totalNonCache : 0
            const outShare = totalNonCache > 0 ? model.tokens.output / totalNonCache : 0
            const reasShare = totalNonCache > 0 ? model.tokens.reasoning / totalNonCache : 0
            const inWidth = Math.max(0, Math.round(inShare * 20))
            const outWidth = Math.max(0, Math.round(outShare * 20))
            const reasWidth = Math.max(0, 20 - inWidth - outWidth)
            return (
              <box flexDirection="row" gap={1} alignItems="center">
                <text fg={theme.text} width={18} wrapMode="none">
                  {(model.modelID.length > 18 ? "…" + model.modelID.slice(-17) : model.modelID).padEnd(18)}
                </text>
                <text fg={viz().input} wrapMode="none">
                  {"█".repeat(inWidth)}
                </text>
                <text fg={viz().output} wrapMode="none">
                  {"█".repeat(outWidth)}
                </text>
                <text fg={viz().reasoning} wrapMode="none">
                  {"█".repeat(reasWidth)}
                </text>
                <text fg={theme.textMuted} wrapMode="none">
                  {formatTokens(totalNonCache)}
                </text>
              </box>
            )
          }}
        </For>
        {/* Legend */}
        <box flexDirection="row" gap={3}>
          <box flexDirection="row" gap={1} alignItems="center">
            <text fg={viz().input} wrapMode="none">
              ■
            </text>
            <text fg={theme.textMuted}>Input</text>
          </box>
          <box flexDirection="row" gap={1} alignItems="center">
            <text fg={viz().output} wrapMode="none">
              ■
            </text>
            <text fg={theme.textMuted}>Output</text>
          </box>
          <box flexDirection="row" gap={1} alignItems="center">
            <text fg={viz().reasoning} wrapMode="none">
              ■
            </text>
            <text fg={theme.textMuted}>Reasoning</text>
          </box>
        </box>
      </Show>
    </box>
  )
}

function ProjectsTab(props: { stats: AggregatedStats }) {
  const { theme } = useTheme()
  const g = () => props.stats.global
  const viz = () => getChartColors(theme)

  const vcsStats = createMemo(() => {
    const git = props.stats.projects.filter((p) => p.vcs === "git").length
    const local = props.stats.projects.filter((p) => p.vcs === "local" || p.vcs === "unknown").length
    return { git, local, total: props.stats.projects.length }
  })

  return (
    <box flexDirection="column" gap={1}>
      <text fg={theme.text} attributes={TextAttributes.BOLD}>
        Projects ({g().projects.length})
      </text>

      {/* VCS Breakdown — text summary + proportional stacked bar so the
          git-vs-local mix is visible at a glance (was a flat row of
          numbers before). */}
      <box flexDirection="row" gap={3}>
        <box flexDirection="row" gap={1} alignItems="center">
          <text fg={theme.textMuted}>Git:</text>
          <text fg={colorToString(theme.success)} attributes={TextAttributes.BOLD}>
            {vcsStats().git}
          </text>
        </box>
        <box flexDirection="row" gap={1} alignItems="center">
          <text fg={theme.textMuted}>Local:</text>
          <text fg={theme.textMuted} attributes={TextAttributes.BOLD}>
            {vcsStats().local}
          </text>
        </box>
        <box flexDirection="row" gap={1} alignItems="center">
          <text fg={theme.textMuted}>Avg sessions:</text>
          <text fg={colorToString(theme.primary)} attributes={TextAttributes.BOLD}>
            {(g().sessions / (vcsStats().total || 1)).toFixed(1)}
          </text>
        </box>
      </box>

      <Show when={vcsStats().total > 0}>
        <StackedBarChartV2
          segments={[
            { label: "Git", value: vcsStats().git, color: viz().cache },
            { label: "Local", value: vcsStats().local, color: viz().input },
          ]}
          width={30}
        />
      </Show>

      {/* Project Cards */}
      <box flexDirection="column" gap={0}>
        <For each={props.stats.projects.slice(0, 8)}>
          {(proj) => (
            <box
              flexDirection="row"
              gap={2}
              alignItems="center"
              border={["bottom"]}
              borderColor={theme.borderSubtle}
              paddingLeft={1}
              paddingRight={1}
            >
              <text fg={proj.vcs === "git" ? theme.success : theme.textMuted} width={3}>
                {proj.vcs === "git" ? "●" : "○"}
              </text>
              <text fg={theme.text} width={16}>
                {proj.name.slice(-16)}
              </text>
              <text fg={theme.textMuted}>{proj.sessionCount}s</text>
              <text fg={theme.primary}>{formatTokens(proj.totalTokens)}</text>
              <text fg={theme.success}>{money.format(proj.totalCost)}</text>
            </box>
          )}
        </For>
      </box>

      <Show when={props.stats.projects.length === 0}>
        <text fg={theme.textMuted}>No projects yet</text>
      </Show>
    </box>
  )
}

function ToolsTab(props: { stats: AggregatedStats }) {
  const { theme } = useTheme()
  const tools = () => props.stats.toolUsage
  const successColor = (rate: number): RGBA => {
    if (rate >= 90) return theme.success
    if (rate >= 70) return theme.warning
    return theme.error
  }

  return (
    <box flexDirection="column" gap={1}>
      <text fg={theme.text} attributes={TextAttributes.BOLD}>
        Tool Usage ({tools().total} calls)
      </text>

      {/* Ranked list with 1/8-cell bar precision. Each bar uses the bar's
          color (theme.success/warning/error) so visual "danger" is encoded
          in the bar itself, not only in the trailing percent column. */}
      <RankedBarList
        items={tools()
          .mostUsed.slice(0, 10)
          .map((t) => ({
            name: t.name.length > 18 ? "…" + t.name.slice(-17) : t.name,
            value: t.count,
            subValue: `${t.successRate.toFixed(0)}%`,
            color: successColor(t.successRate),
          }))}
        nameWidth={18}
        barWidth={22}
        formatValue={(v) => formatCompact(v)}
      />

      <Show when={tools().mostUsed.length === 0}>
        <text fg={theme.textMuted}>No tool usage data</text>
      </Show>

      {/* Legend */}
      <box flexDirection="row" gap={3}>
        <box flexDirection="row" gap={1} alignItems="center">
          <text fg={colorToString(theme.success)} wrapMode="none">
            ■
          </text>
          <text fg={theme.textMuted}>90%+ success</text>
        </box>
        <box flexDirection="row" gap={1} alignItems="center">
          <text fg={colorToString(theme.warning)} wrapMode="none">
            ■
          </text>
          <text fg={theme.textMuted}>70-90%</text>
        </box>
        <box flexDirection="row" gap={1} alignItems="center">
          <text fg={colorToString(theme.error)} wrapMode="none">
            ■
          </text>
          <text fg={theme.textMuted}>&lt;70%</text>
        </box>
      </box>
    </box>
  )
}

const SESSIONS_SECTIONS = ["sessions", "top", "background", "workspaces"] as const

function SessionsTab(props: { stats: AggregatedStats }) {
  const { theme } = useTheme()
  const viz = () => getChartColors(theme)
  const g = () => props.stats.global
  const ws = () => props.stats.workspaces
  const topSessions = createMemo(() => props.stats.sessions.slice(0, 5))
  const bg = () => props.stats.backgroundRuns
  const { open, toggle, focused } = useCollapsibleGroup(SESSIONS_SECTIONS)

  return (
    <box flexDirection="column" gap={2}>
      {/* Session Stats */}
      <CollapsibleSection
        title="Sessions"
        hint={`(${g().sessions})`}
        open={open().sessions}
        focused={focused("sessions")}
        onToggle={() => toggle("sessions")}
      >
        <box flexDirection="row" gap={3}>
          <box flexDirection="row" gap={1} alignItems="center">
            <text fg={theme.textMuted}>Total:</text>
            <text fg={colorToString(theme.primary)} attributes={TextAttributes.BOLD}>
              {g().sessions}
            </text>
          </box>
          <box flexDirection="row" gap={1} alignItems="center">
            <text fg={theme.textMuted}>Active:</text>
            <text fg={colorToString(theme.success)} attributes={TextAttributes.BOLD}>
              {g().sessions - g().archivedSessions}
            </text>
          </box>
          <box flexDirection="row" gap={1} alignItems="center">
            <text fg={theme.textMuted}>Archived:</text>
            <text fg={theme.textMuted} attributes={TextAttributes.BOLD}>
              {g().archivedSessions}
            </text>
          </box>
        </box>
      </CollapsibleSection>

      {/* Top Sessions */}
      <CollapsibleSection
        title="Top by Tokens"
        open={open().top}
        focused={focused("top")}
        onToggle={() => toggle("top")}
      >
        <For each={topSessions()}>
          {(session) => {
            const total = session.tokens.input + session.tokens.output + session.tokens.reasoning
            return (
              <box flexDirection="row" gap={1} alignItems="center">
                <text fg={theme.text} width={14}>
                  {session.title.slice(-14)}
                </text>
                <text fg={theme.primary}>{formatTokens(total)}</text>
                <text fg={theme.success}>{money.format(session.cost)}</text>
              </box>
            )
          }}
        </For>
        <Show when={topSessions().length === 0}>
          <text fg={theme.textMuted}>No sessions yet</text>
        </Show>
      </CollapsibleSection>

      {/* Background Runs */}
      <CollapsibleSection
        title="Background Runs"
        hint={`(${bg().total})`}
        open={open().background}
        focused={focused("background")}
        onToggle={() => toggle("background")}
      >
        <Show when={bg().total > 0} fallback={<text fg={theme.textMuted}>No background runs</text>}>
          <StackedBarChartV2
            segments={[
              { label: "Completed", value: bg().completed, color: viz().cache },
              { label: "Running", value: bg().running, color: viz().input },
              { label: "Error", value: bg().error, color: viz().alert },
              {
                label: "Cancelled",
                value: bg().cancelled,
                color: viz().reasoning,
              },
            ]}
            width={35}
            showLabels
          />
          <box flexDirection="row" gap={3}>
            <box flexDirection="row" gap={1} alignItems="center">
              <text fg={theme.textMuted}>Success:</text>
              <text fg={colorToString(theme.success)}>{bg().successRate.toFixed(0)}%</text>
            </box>
            <box flexDirection="row" gap={1} alignItems="center">
              <text fg={theme.textMuted}>Avg duration:</text>
              <text fg={viz().input}>{formatDuration(bg().avgDuration)}</text>
            </box>
          </box>
        </Show>
      </CollapsibleSection>

      {/* Top Agents — `bg().topAgents` was computed but never visualized. */}
      <Show when={bg().topAgents.length > 0}>
        <CollapsibleSection
          title="Top Agents"
          hint={`(${bg().topAgents.length})`}
          open={open().background}
          focused={focused("background")}
          onToggle={() => toggle("background")}
        >
          <RankedBarList
            items={bg().topAgents.map((a) => ({
              name: a.agent,
              value: a.count,
              color: viz().input,
            }))}
            nameWidth={18}
            barWidth={20}
            formatValue={(v) => formatCompact(v)}
          />
        </CollapsibleSection>
      </Show>

      {/* Workspaces Summary */}
      <CollapsibleSection
        title="Workspaces"
        hint={`(${ws().total})`}
        open={open().workspaces}
        focused={focused("workspaces")}
        onToggle={() => toggle("workspaces")}
      >
        <box flexDirection="row" gap={3}>
          <box flexDirection="row" gap={1} alignItems="center">
            <text fg={theme.textMuted}>Total:</text>
            <text fg={colorToString(theme.primary)}>{ws().total}</text>
          </box>
          <box flexDirection="row" gap={1} alignItems="center">
            <text fg={theme.textMuted}>Active:</text>
            <text fg={colorToString(theme.success)}>{ws().active}</text>
          </box>
          <box flexDirection="row" gap={1} alignItems="center">
            <text fg={theme.textMuted}>Disconnected:</text>
            <text fg={colorToString(theme.error)}>{ws().disconnected}</text>
          </box>
        </box>

        {/* Type breakdown */}
        <Show when={Object.keys(ws().byType).length > 0}>
          <text fg={theme.textMuted}>By type:</text>
          <box flexDirection="row" gap={2}>
            <For each={Object.entries(ws().byType)}>
              {([type, count]) => (
                <box flexDirection="row" gap={1} alignItems="center">
                  <text fg={colorToString(theme.accent)}>{type}:</text>
                  <text fg={theme.text}>{count}</text>
                </box>
              )}
            </For>
          </box>
        </Show>
      </CollapsibleSection>
    </box>
  )
}
