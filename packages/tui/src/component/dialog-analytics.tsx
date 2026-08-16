import { TextAttributes, RGBA, ScrollBoxRenderable } from "@opentui/core"
import { useTheme, type Theme } from "../context/theme"
import { useSync } from "@tui/context/sync"
import { useAnalytics } from "../context/analytics"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { For, Show, createSignal, createMemo, createEffect, onMount, onCleanup, type ParentProps } from "solid-js"
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
  Gauge,
  VerticalBarChart,
  getChartColors,
} from "./chart-braille-line"
import {
  buildDurationHistogram,
  computeAnalyticsDialogLayout,
  formatCompact,
  formatRelativeTime,
  periodDelta,
  sampleForSparkline,
  weightedToolSuccess,
} from "../util/analytics-utils"

// ===== Color utilities =====

function colorToString(color: string | { r: number; g: number; b: number; a?: number }): string {
  if (typeof color === "string") return color
  const { r, g, b, a = 1 } = color
  const byte = (value: number) => Math.max(0, Math.min(255, Math.round(value <= 1 ? value * 255 : value)))
  const red = byte(r)
  const green = byte(g)
  const blue = byte(b)
  if (a === 1) {
    return `#${red.toString(16).padStart(2, "0")}${green.toString(16).padStart(2, "0")}${blue
      .toString(16)
      .padStart(2, "0")}`
  }
  return `#${red.toString(16).padStart(2, "0")}${green.toString(16).padStart(2, "0")}${blue
    .toString(16)
    .padStart(2, "0")}${byte(a).toString(16).padStart(2, "0")}`
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

// Usable content width inside the scrollable area, in columns. Accounts for
// every layer of chrome between the terminal edge and the chart:
//   dialog width = min(116, term-8)
//   − dialog box padding (2+2)  − root box padding (3+3)
//   − scroll border (1+1)       − inner box padding (2+2)  − scrollbar (1)
// = dialog − 17. Collapsible chart sections reserve another 2 columns.
function useContentWidth() {
  const dims = useTerminalDimensions()
  return createMemo(() => computeAnalyticsDialogLayout(dims().width, dims().height).contentWidth)
}

// Responsive chart width capped so charts don't get comically wide on
// ultra-wide terminals. `cap` is the maximum drawn width.
function useChartWidth(cap = 72) {
  const dims = useTerminalDimensions()
  return createMemo(() => Math.min(cap, computeAnalyticsDialogLayout(dims().width, dims().height).sectionWidth))
}

// ===== MAIN DIALOG =====

type TabId = "overview" | "tokens" | "models" | "tools" | "projects" | "sessions"
type AnalyticsSource = "live" | "live+history"
type DashboardStatus = "info" | "success" | "warning" | "error"

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: "overview", label: "Overview", icon: "◈" },
  { id: "tokens", label: "Tokens", icon: "▦" },
  { id: "models", label: "Models", icon: "◆" },
  { id: "tools", label: "Tools", icon: "✦" },
  { id: "projects", label: "Projects", icon: "▣" },
  { id: "sessions", label: "Sessions", icon: "⊞" },
]

// Animated braille spinner frames for the loading state.
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const

export function DialogAnalytics(_props: { onClose: () => void }) {
  const { theme } = useTheme()
  const sync = useSync()
  const analyticsCtx = useAnalytics()
  const dialog = useDialog()
  const dimensions = useTerminalDimensions()
  const layout = createMemo(() => computeAnalyticsDialogLayout(dimensions().width, dimensions().height))

  const [loading, setLoading] = createSignal(true)
  const [stats, setStats] = createSignal<AggregatedStats | null>(null)
  const [activeTab, setActiveTab] = createSignal<TabId>("overview")
  const [loadError, setLoadError] = createSignal<string>()
  const [source, setSource] = createSignal<AnalyticsSource>("live")
  const [refreshedAt, setRefreshedAt] = createSignal(0)

  // Cap the scrollable content area to the visible terminal so the panel
  // never spills below the viewport. Header (2) + tab strip (2) + scroll bar
  // (1) + gaps/border/padding reserve ~12 rows; the rest scrolls inside.
  const contentHeight = createMemo(() => layout().contentHeight)

  // Animated spinner frame, advanced on a timer only while loading.
  const [spinner, setSpinner] = createSignal(0)
  // Scroll position of the content box: { top, max } in rows. Polled from the
  // scrollbox ref since opentui doesn't emit a scroll event we can bind to.
  const [scrollPos, setScrollPos] = createSignal<{ top: number; max: number }>({
    top: 0,
    max: 0,
  })
  let scrollRef: ScrollBoxRenderable | undefined

  onMount(async () => {
    dialog.setSize("xlarge")

    const spin = setInterval(() => {
      if (loading()) setSpinner((f) => (f + 1) % SPINNER_FRAMES.length)
    }, 90)
    // Lightweight scroll poll (~12fps) — cheap, and only while the dialog is
    // mounted. Drives the ▲/▼ + percentage indicator on the content frame.
    const poll = setInterval(() => {
      const s = scrollRef
      if (!s || s.isDestroyed) return
      const max = Math.max(0, (s.scrollHeight ?? 0) - (s.height ?? 0))
      const top = Math.max(0, Math.min(max, s.scrollTop ?? 0))
      const prev = scrollPos()
      if (prev.top !== top || prev.max !== max) setScrollPos({ top, max })
    }, 80)
    // Live refreshes are billed to the server worker, so they only run while
    // this panel is on screen.
    const unwatch = analyticsCtx.watch()
    onCleanup(() => {
      clearInterval(spin)
      clearInterval(poll)
      unwatch()
    })

    await loadAnalytics()
  })

  // Projects and Sessions are the two tabs that read per-session rows.
  createEffect(() => {
    const tab = activeTab()
    if (tab === "sessions" || tab === "projects") void ensureSessionsLoaded()
  })

  // Scroll indicator state derived from the polled position.
  const scrollInfo = createMemo(() => {
    const { top, max } = scrollPos()
    if (max <= 0) return { scrollable: false, pct: 0, up: false, down: false }
    return {
      scrollable: true,
      pct: Math.round((top / max) * 100),
      up: top > 0,
      down: top < max,
    }
  })

  // Headline numbers for the header subtitle.
  const headerSummary = createMemo(() => {
    const s = stats()
    if (!s) return undefined
    const days = s.days
    const firstDay = days.find((d) => d.tokens > 0 || d.cost > 0)?.date
    const lastDay = [...days].reverse().find((d) => d.tokens > 0 || d.cost > 0)?.date
    return {
      range: firstDay && lastDay ? `${firstDay} → ${lastDay}` : "all time",
      sessions: s.global.sessions,
      cost: s.global.cost,
      tokens: s.global.tokens.input + s.global.tokens.output + s.global.tokens.reasoning,
    }
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

  // The live pass, kept so the lazily fetched session list can be folded into
  // the same aggregate later without redoing it.
  let liveBase: AggregatedStats | null = null

  /** Fold whatever history has loaded so far into the live aggregate. */
  function withHistory(live: AggregatedStats, gotHistorical: boolean): AggregatedStats {
    let merged = gotHistorical
      ? mergeWithHistorical(live, { global: analyticsCtx.global(), daily: analyticsCtx.daily() })
      : live
    const persisted = analyticsCtx.sessions()
    if (persisted.length > 0) {
      merged = { ...merged, sessions: mergeSessionsFromApi(merged.sessions, persisted) }
      merged = augmentAggregatedStatsFromPersistedSessions(merged, persisted)
    }
    return merged
  }

  /**
   * `/analytics/sessions` aggregates every message of every session and is the
   * slowest of the three, so it is never awaited before the first paint. It is
   * still always fetched: `mergeWithHistorical` only fills days, totals, models
   * and providers, so Projects and Sessions stay on live-sync data until this
   * lands.
   */
  const [sessionsRequested, setSessionsRequested] = createSignal(false)
  async function ensureSessionsLoaded() {
    if (sessionsRequested()) return
    setSessionsRequested(true)
    await analyticsCtx.refreshSessions()
    if (liveBase) setStats(withHistory(liveBase, source() === "live+history"))
  }

  async function loadAnalytics() {
    setLoading(true)
    setLoadError(undefined)
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
      liveBase = liveStats

      // Show the live pass straight away and upgrade in place once history
      // arrives. The first uncached read walks the whole message history, and a
      // panel showing today's numbers now beats a spinner showing nothing.
      setSource("live")
      setStats(liveStats)
      setRefreshedAt(Date.now())
      setLoading(false)

      const gotHistorical = await analyticsCtx.refresh().catch(() => false)
      if (gotHistorical) {
        setSource("live+history")
        setStats(withHistory(liveStats, true))
        setRefreshedAt(Date.now())
      }

      // Then fold in the session list, in the background. Projects, Tools and
      // Sessions all read per-session rows, so gating this on which tab was
      // open left them showing only the current session.
      setSessionsRequested(false)
      void ensureSessionsLoaded()
    } catch (e) {
      console.error("Failed to load analytics:", e)
      setLoadError(e instanceof Error ? e.message : "Analytics could not be loaded")
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

  // Tab navigation. The content scrollbox is focused (so ↑↓/wheel scroll),
  // and it swallows the arrow keys for its own horizontal/vertical scroll —
  // so tab switching is bound to Tab/Shift+Tab and the number keys, mirroring
  // the OpenTUI dashboard. Handled keys are stopped so the scrollbox doesn't
  // also act on them. Arrows are kept as a best-effort fallback.
  useKeyboard((evt) => {
    if (evt.name === "r" && loadError()) {
      void loadAnalytics()
      evt.preventDefault?.()
      evt.stopPropagation?.()
      return
    }
    if (/^[1-6]$/.test(evt.name)) {
      const idx = parseInt(evt.name, 10) - 1
      if (idx >= 0 && idx < TABS.length) {
        setActiveTab(TABS[idx]!.id)
        evt.preventDefault?.()
        evt.stopPropagation?.()
      }
      return
    }
    if (evt.name === "tab" && !evt.shift) {
      nextTab()
      evt.preventDefault?.()
      evt.stopPropagation?.()
      return
    }
    if (evt.name === "tab" && evt.shift) {
      prevTab()
      evt.preventDefault?.()
      evt.stopPropagation?.()
      return
    }
    if (evt.name === "arrow-left" || evt.name === "left") prevTab()
    else if (evt.name === "arrow-right" || evt.name === "right") nextTab()
  })

  return (
    <box paddingLeft={3} paddingRight={3} gap={1} paddingBottom={1}>
      {/* Header: title + live summary on the left, controls hint on the right */}
      <box flexDirection="row" justifyContent="space-between" alignItems="flex-start" flexWrap="wrap" gap={1}>
        <box flexDirection="column" gap={0}>
          <text fg={theme.accent.alt} attributes={TextAttributes.BOLD} wrapMode="none">
            ◈ ANALYTICS
          </text>
          <Show when={headerSummary()}>
            <text fg={theme.foreground.muted} wrapMode="none">
              {headerSummary()!.range} · {headerSummary()!.sessions} sessions · {formatTokens(headerSummary()!.tokens)}{" "}
              tokens · {money.format(headerSummary()!.cost)}
            </text>
          </Show>
        </box>
        <text fg={theme.foreground.muted} wrapMode="none">
          tab/1-6 · ↑↓ scroll · esc
        </text>
      </box>

      {/* Loading: animated spinner + skeleton hint */}
      <Show when={loading()}>
        <box height={contentHeight()} alignItems="center" justifyContent="center" flexShrink={0}>
          <box flexDirection="row" gap={1} alignItems="center">
            <text fg={theme.accent.alt} wrapMode="none">
              {SPINNER_FRAMES[spinner()]}
            </text>
            <text fg={theme.foreground.muted} wrapMode="none">
              Crunching analytics…
            </text>
          </box>
        </box>
      </Show>

      <Show when={!loading() && !stats()}>
        <box
          height={contentHeight()}
          border
          borderColor={theme.status.error.fg}
          alignItems="center"
          justifyContent="center"
          flexShrink={0}
        >
          <box flexDirection="column" gap={1} alignItems="center" paddingLeft={2} paddingRight={2}>
            <text fg={theme.status.error.fg} attributes={TextAttributes.BOLD} wrapMode="none">
              ✗ Analytics unavailable
            </text>
            <text fg={theme.foreground.muted} wrapMode="word">
              {loadError() ?? "No analytics data was returned"}
            </text>
            <text fg={theme.accent.fg} onMouseUp={() => void loadAnalytics()} wrapMode="none">
              [r / click to retry]
            </text>
          </box>
        </box>
      </Show>

      <Show when={!loading() && stats() && (layout().contentWidth < 25 || layout().contentHeight < 4)}>
        <box
          height={contentHeight()}
          border
          borderColor={theme.status.warning.fg}
          alignItems="center"
          justifyContent="center"
          flexShrink={0}
        >
          <box flexDirection="column" gap={1} alignItems="center" paddingLeft={1} paddingRight={1}>
            <text fg={theme.status.warning.fg} attributes={TextAttributes.BOLD} wrapMode="none">
              ⚠ Terminal too narrow
            </text>
            <text fg={theme.foreground.muted} wrapMode="word">
              Resize to at least 50 columns and 16 rows to render analytics charts without clipping.
            </text>
          </box>
        </box>
      </Show>

      <Show when={!loading() && stats() && layout().contentWidth >= 25 && layout().contentHeight >= 4}>
        {/* Tab strip — full chip row: icon + number + label, active chip
            highlighted with an accent background, underline bar, and border.
            Each chip is clickable; numbers map to the 1-6 shortcuts. */}
        <box flexDirection="row" gap={1} flexWrap="wrap" flexShrink={0}>
          <For each={TABS}>
            {(tab, i) => {
              const isActive = createMemo(() => tab.id === activeTab())
              return (
                <box flexDirection="column" gap={0} flexShrink={0} onMouseUp={() => setActiveTab(tab.id)}>
                  <box
                    flexDirection="row"
                    gap={1}
                    alignItems="center"
                    paddingLeft={1}
                    paddingRight={1}
                    backgroundColor={isActive() ? theme.surface.offset : undefined}
                  >
                    <text
                      fg={isActive() ? theme.accent.alt : theme.foreground.muted}
                      attributes={isActive() ? TextAttributes.BOLD : undefined}
                      wrapMode="none"
                    >
                      {tab.icon}
                    </text>
                    <text
                      fg={isActive() ? theme.accent.fg : theme.foreground.muted}
                      attributes={isActive() ? TextAttributes.BOLD : undefined}
                      wrapMode="none"
                    >
                      {i() + 1} {tab.label}
                    </text>
                  </box>
                  {/* active underline — matches the chip's inner width
                      (padding 2 + icon 1 + gap 1 + "N "(2) + label). */}
                  <text fg={isActive() ? theme.accent.alt : theme.surface.panel} wrapMode="none">
                    {"─".repeat(tab.label.length + 6)}
                  </text>
                </box>
              )
            }}
          </For>
        </box>

        {/* Scrollable content area — height-capped to the viewport so the
            panel can never grow past the bottom of the terminal. The
            scrollbox is focused so ↑↓/PageUp/PageDown and the mouse wheel
            scroll the active tab; tab/1-6 switch tabs and section headers
            toggle on click. `keyed` on the tab id remounts content per tab so
            scroll offset resets when you switch. */}
        <box border borderColor={theme.border.default} height={contentHeight()} flexShrink={0}>
          <scrollbox
            ref={(r: ScrollBoxRenderable) => (scrollRef = r)}
            height={contentHeight() - 2}
            focused={true}
            scrollbarOptions={{ visible: true }}
          >
            <box paddingTop={1} paddingBottom={1} paddingLeft={2} paddingRight={2}>
              <Show when={activeTab()} keyed>
                {(tab) => (
                  <>
                    <Show when={tab === "overview"}>
                      <OverviewTab
                        stats={stats()!}
                        last30Days={last30Days()}
                        source={source()}
                        refreshedAt={refreshedAt()}
                        historyLoading={analyticsCtx.loading()}
                      />
                    </Show>
                    <Show when={tab === "tokens"}>
                      <TokensTab stats={stats()!} last14Days={last14Days()} />
                    </Show>
                    <Show when={tab === "models"}>
                      <ModelsTab stats={stats()!} />
                    </Show>
                    <Show when={tab === "tools"}>
                      <ToolsTab stats={stats()!} />
                    </Show>
                    <Show when={tab === "projects"}>
                      <ProjectsTab stats={stats()!} />
                    </Show>
                    <Show when={tab === "sessions"}>
                      <SessionsTab stats={stats()!} />
                    </Show>
                  </>
                )}
              </Show>
            </box>
          </scrollbox>
        </box>

        {/* Scroll indicator — shows there's more above/below and how far
            through the tab you are. Only when the content overflows. */}
        <box flexDirection="row" justifyContent="space-between" alignItems="center" flexShrink={0}>
          <text fg={theme.foreground.muted} wrapMode="none">
            {TABS.find((t) => t.id === activeTab())?.label} · {tabIndex() + 1}/{TABS.length}
          </text>
          <Show when={scrollInfo().scrollable}>
            <box flexDirection="row" gap={1} alignItems="center">
              <text fg={scrollInfo().up ? theme.accent.alt : theme.border.subtle} wrapMode="none">
                ▲
              </text>
              <text fg={theme.foreground.muted} wrapMode="none">
                {scrollInfo().pct}%
              </text>
              <text fg={scrollInfo().down ? theme.accent.alt : theme.border.subtle} wrapMode="none">
                ▼
              </text>
            </box>
          </Show>
        </box>
      </Show>
    </box>
  )
}

// ===== SHARED UI =====

// Centered empty-state placeholder with an icon, used wherever a section has
// no data yet — reads as intentional rather than a stray left-aligned string.
function EmptyState(props: { icon?: string; message: string }) {
  const { theme } = useTheme()
  return (
    <box flexDirection="row" gap={1} alignItems="center" paddingTop={1} paddingBottom={1} justifyContent="center">
      <text fg={theme.border.subtle} wrapMode="none">
        {props.icon ?? "○"}
      </text>
      <text fg={theme.foreground.muted} wrapMode="none">
        {props.message}
      </text>
    </box>
  )
}

function DataSourceBanner(props: {
  stats: AggregatedStats
  source: AnalyticsSource
  refreshedAt: number
  historyLoading: boolean
}) {
  const { theme } = useTheme()
  const firstDay = () => props.stats.days.find((day) => day.tokens > 0 || day.messages > 0 || day.cost > 0)?.date
  const lastDay = () =>
    [...props.stats.days].reverse().find((day) => day.tokens > 0 || day.messages > 0 || day.cost > 0)?.date
  const range = () => (firstDay() && lastDay() ? `${firstDay()} → ${lastDay()}` : "current activity")
  // The panel renders the live pass first, so say so rather than presenting a
  // partial window as the whole history.
  const sourceLabel = () =>
    props.source === "live+history"
      ? "live sync + persisted history"
      : props.historyLoading
        ? "live sync · loading history…"
        : "live sync"
  const refreshed = () =>
    props.refreshedAt > 0
      ? new Date(props.refreshedAt).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        })
      : "now"

  return (
    <box
      border
      borderColor={props.source === "live+history" ? theme.status.info.fg : theme.border.subtle}
      paddingLeft={1}
      paddingRight={1}
      flexDirection="row"
      justifyContent="space-between"
      alignItems="center"
      flexWrap="wrap"
      gap={1}
    >
      <box flexDirection="row" gap={1} alignItems="center" flexWrap="wrap">
        <text fg={theme.status.info.fg} attributes={TextAttributes.BOLD} wrapMode="none">
          ℹ DATA SOURCE
        </text>
        <text fg={theme.foreground.default} wrapMode="word">
          {sourceLabel()}
        </text>
        <text fg={theme.foreground.muted} wrapMode="word">
          · {range()}
        </text>
      </box>
      <text fg={theme.foreground.muted} wrapMode="none">
        refreshed {refreshed()}
      </text>
    </box>
  )
}

function TabHeading(props: { icon: string; title: string; description: string; meta?: string }) {
  const { theme } = useTheme()
  return (
    <box flexDirection="row" justifyContent="space-between" alignItems="flex-start" flexWrap="wrap" gap={1}>
      <box flexDirection="column" gap={0}>
        <box flexDirection="row" gap={1} alignItems="center">
          <text fg={theme.accent.alt} attributes={TextAttributes.BOLD} wrapMode="none">
            {props.icon}
          </text>
          <text fg={theme.foreground.default} attributes={TextAttributes.BOLD} wrapMode="none">
            {props.title}
          </text>
        </box>
        <text fg={theme.foreground.muted} wrapMode="word">
          {props.description}
        </text>
      </box>
      <Show when={props.meta}>
        <text fg={theme.accent.secondary} wrapMode="none">
          {props.meta}
        </text>
      </Show>
    </box>
  )
}

function dashboardStatusColor(theme: Theme, status: DashboardStatus): RGBA {
  if (status === "success") return theme.status.success.fg
  if (status === "warning") return theme.status.warning.fg
  if (status === "error") return theme.status.error.fg
  return theme.status.info.fg
}

const DASHBOARD_STATUS_ICON: Record<DashboardStatus, string> = {
  info: "ℹ",
  success: "✓",
  warning: "⚠",
  error: "✗",
}

function AnalyticsStatusGrid(props: { items: Array<{ label: string; detail: string; status: DashboardStatus }> }) {
  const { theme } = useTheme()
  const dimensions = useTerminalDimensions()
  const columns = createMemo(() => computeAnalyticsDialogLayout(dimensions().width, dimensions().height).columns)
  const rows = createMemo(() => {
    const result: Array<typeof props.items> = []
    for (let i = 0; i < props.items.length; i += columns()) result.push(props.items.slice(i, i + columns()))
    return result
  })

  return (
    <box flexDirection="column" gap={1}>
      <For each={rows()}>
        {(row) => (
          <box flexDirection="row" gap={1} flexWrap="wrap">
            <For each={row}>
              {(item) => {
                const color = () => dashboardStatusColor(theme, item.status)
                return (
                  <box
                    border
                    borderColor={color()}
                    paddingLeft={1}
                    paddingRight={1}
                    minWidth={18}
                    flexGrow={1}
                    flexShrink={1}
                  >
                    <box flexDirection="row" gap={1} alignItems="center">
                      <text fg={color()} attributes={TextAttributes.BOLD} wrapMode="none">
                        {DASHBOARD_STATUS_ICON[item.status]}
                      </text>
                      <text fg={theme.foreground.default} attributes={TextAttributes.BOLD} wrapMode="none">
                        {item.label}
                      </text>
                    </box>
                    <text fg={theme.foreground.muted} wrapMode="word">
                      {item.detail}
                    </text>
                  </box>
                )
              }}
            </For>
          </box>
        )}
      </For>
    </box>
  )
}

function AnalyticsHistogram(props: { bins: Array<{ label: string; count: number }>; width: number; color: RGBA }) {
  const { theme } = useTheme()
  const max = createMemo(() => Math.max(1, ...props.bins.map((bin) => bin.count)))
  const barWidth = createMemo(() => Math.max(6, props.width - 14))

  return (
    <box flexDirection="column" gap={0}>
      <For each={props.bins}>
        {(bin) => {
          const filled = () => Math.round((bin.count / max()) * barWidth())
          return (
            <box flexDirection="row" gap={1} alignItems="center">
              <text fg={theme.foreground.muted} width={7} wrapMode="none">
                {bin.label.padEnd(7)}
              </text>
              <text fg={props.color} wrapMode="none">
                {"▆".repeat(filled())}
              </text>
              <text fg={theme.border.subtle} wrapMode="none">
                {"·".repeat(Math.max(0, barWidth() - filled()))}
              </text>
              <text fg={theme.foreground.default} width={4} wrapMode="none">
                {String(bin.count).padStart(4)}
              </text>
            </box>
          )
        }}
      </For>
    </box>
  )
}

function RecentSessionTimeline(props: { sessions: AggregatedStats["sessions"] }) {
  const { theme } = useTheme()
  const chartW = useChartWidth(72)
  const recent = createMemo(() => [...props.sessions].sort((a, b) => b.updated - a.updated).slice(0, 6))
  const titleW = createMemo(() => Math.max(8, Math.min(36, chartW() - 2)))

  return (
    <Show when={recent().length > 0} fallback={<EmptyState message="No recent sessions" />}>
      <box flexDirection="column" gap={0}>
        <For each={recent()}>
          {(session, index) => {
            const tokens = () => session.tokens.input + session.tokens.output + session.tokens.reasoning
            const isLast = () => index() === recent().length - 1
            return (
              <box flexDirection="column" gap={0}>
                <box flexDirection="row" gap={1} alignItems="center" flexWrap="wrap">
                  <text fg={theme.status.success.fg} attributes={TextAttributes.BOLD} wrapMode="none">
                    ✓
                  </text>
                  <text fg={theme.foreground.default} attributes={TextAttributes.BOLD} width={titleW()} wrapMode="none">
                    {(session.title || "Untitled session").slice(0, titleW())}
                  </text>
                  <text fg={theme.accent.fg} wrapMode="none">
                    {formatTokens(tokens())}
                  </text>
                  <text fg={theme.status.success.fg} wrapMode="none">
                    {money.format(session.cost)}
                  </text>
                  <text fg={theme.foreground.muted} wrapMode="none">
                    {formatRelativeTime(session.updated)}
                  </text>
                </box>
                <Show when={!isLast()}>
                  <text fg={theme.border.subtle} wrapMode="none">
                    │
                  </text>
                </Show>
              </box>
            )
          }}
        </For>
      </box>
    </Show>
  )
}

function LegendDot(props: { color: ReturnType<typeof getChartColors>["input"]; label: string }) {
  const { theme } = useTheme()
  return (
    <box flexDirection="row" gap={1} alignItems="center">
      <text fg={props.color} wrapMode="none">
        ■
      </text>
      <text fg={theme.foreground.muted} wrapMode="none">
        {props.label}
      </text>
    </box>
  )
}

function CollapsibleSection(
  props: ParentProps<{
    title: string
    open: boolean
    hint?: string
    onToggle: () => void
  }>,
) {
  const { theme } = useTheme()
  return (
    <box
      flexDirection="column"
      gap={1}
      border={["left"]}
      borderColor={props.open ? theme.border.active : theme.border.subtle}
      paddingLeft={1}
    >
      <box flexDirection="row" gap={1} alignItems="center" onMouseUp={() => props.onToggle()}>
        {/* Accent chevron = the clickable affordance for the section. */}
        <text fg={theme.accent.alt} wrapMode="none">
          {props.open ? "▾" : "▶"}
        </text>
        <text fg={theme.foreground.default} attributes={TextAttributes.BOLD} wrapMode="none">
          {props.title}
        </text>
        <Show when={props.hint}>
          <text fg={theme.foreground.muted} wrapMode="none">
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

// Collapsible group state. Sections start open and toggle on click. Vertical
// keyboard navigation lives on the focused scrollbox (↑↓/space scroll), so the
// sections are mouse-toggle only to avoid fighting it.
function useCollapsibleGroup<T extends string>(sections: readonly T[]) {
  const [open, setOpen] = createSignal<Record<T, boolean>>(
    Object.fromEntries(sections.map((s) => [s, true])) as Record<T, boolean>,
  )
  const toggle = (id: T) => setOpen((o) => ({ ...o, [id]: !o[id] }))

  return { open, toggle }
}

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
  return RGBA.fromValues(a.r + (b.r - a.r) * t, a.g + (b.g - a.g) * t, a.b + (b.b - a.b) * t, 1)
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
  const base = theme.surface.offset
  const bright = lerpRgba(base, theme.foreground.default, 0.18)
  return [
    bright, // 0 — empty
    lerpRgba(bright, theme.accent.fg, 0.35),
    lerpRgba(bright, theme.accent.fg, 0.6),
    lerpRgba(bright, theme.accent.fg, 0.85),
    theme.accent.fg,
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
      <text fg={theme.foreground.muted} wrapMode="none">
        {props.label}
      </text>
      <box flexDirection="row" gap={1} alignItems="baseline">
        <text fg={theme.foreground.default} attributes={TextAttributes.BOLD} wrapMode="none">
          {props.value}
        </text>
        <Show when={props.hint}>
          <text fg={theme.foreground.muted} wrapMode="none">
            {props.hint}
          </text>
        </Show>
      </box>
    </box>
  )
}

function ActivityHeatmap(props: { stats: AggregatedStats }) {
  const { theme } = useTheme()
  const chartW = useChartWidth(110)

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

  // One week consumes one terminal column; reserve four columns for the
  // day-label gutter. This keeps the grid inside the measured section width.
  const lookbackDays = createMemo(() => Math.min(365, Math.max(7, (chartW() - 4) * 7)))
  const visibleDays = createMemo(() => props.stats.days.slice(-lookbackDays()))
  const grid = createMemo(() => buildActivityGrid(visibleDays(), lookbackDays(), metricSelector))
  const stats = createMemo(() => computeActivityStats(visibleDays(), metricSelector))

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
          backgroundColor={theme.surface.offset}
          paddingLeft={1}
          paddingRight={1}
          onMouseUp={() => cycleMetric()}
        >
          <text fg={theme.foreground.muted} wrapMode="none">
            metric:
          </text>
          <text fg={theme.accent.fg} attributes={TextAttributes.BOLD} wrapMode="none">
            {metricLabel()}
          </text>
          <Show when={chartW() >= 36}>
            <text fg={theme.foreground.muted} wrapMode="none">
              [tap to cycle]
            </text>
          </Show>
        </box>
      </box>

      <Show
        when={grid().weeks > 0 && stats().totalDays > 0}
        fallback={<EmptyState icon="▦" message="No activity in the last year" />}
      >
        {/* Grid: dow gutter + (month labels + 7 rows of cells) */}
        <box flexDirection="row" gap={1}>
          <box flexDirection="column" gap={0} flexShrink={0}>
            {/* Spacer to align with the month-labels row above the cells */}
            <text> </text>
            <For each={dowLabels}>
              {(label) => (
                <text fg={theme.foreground.muted} wrapMode="none">
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
                    <text fg={theme.foreground.muted} width={1} wrapMode="none">
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
        <box flexDirection="row" gap={1} alignItems="center" flexWrap="wrap">
          <text fg={theme.foreground.muted} wrapMode="none">
            Less
          </text>
          <For each={legendStops()}>
            {(c) => (
              <box backgroundColor={c} flexShrink={0}>
                <text> </text>
              </box>
            )}
          </For>
          <text fg={theme.foreground.muted} wrapMode="none">
            More
          </text>
          <text fg={theme.border.default} wrapMode="none">
            {" "}
            ·{" "}
          </text>
          <text fg={theme.foreground.muted} wrapMode="none">
            peak {metric() === "cost" ? money.format(grid().maxValue) : formatTokens(grid().maxValue)} {metricLabel()}
            /day
          </text>
        </box>
      </Show>
    </box>
  )
}

function OverviewTab(props: {
  stats: AggregatedStats
  last30Days: typeof props.stats.days
  source: AnalyticsSource
  refreshedAt: number
  historyLoading: boolean
}) {
  const { theme } = useTheme()
  const g = () => props.stats.global
  const viz = () => getChartColors(theme)

  const chartW = useChartWidth(72)
  const dimensions = useTerminalDimensions()
  const layout = createMemo(() => computeAnalyticsDialogLayout(dimensions().width, dimensions().height))
  // Gauge width is the track only; reserve six columns for its percentage.
  const gaugeW = createMemo(() =>
    layout().compact
      ? Math.max(6, layout().sectionWidth - 6)
      : Math.max(6, Math.min(26, Math.floor((layout().sectionWidth - 4) / 2) - 6)),
  )
  // Daily breakdown row reserves: date(6) + tokens(8) + cost(9) + 3 gaps(6).
  const dailyBarW = createMemo(() => Math.max(12, chartW() - 30))
  // Four KPI cards share the full content width; min 20 so subtitles fit.
  // When the terminal is too narrow for 4-up the row wraps to 2×2.
  const contentW = useContentWidth()
  const cardW = createMemo(() => {
    const columns = layout().columns
    return Math.max(18, Math.min(28, Math.floor((contentW() - (columns - 1) * 2) / columns)))
  })
  // Date labels for the trend chart's X axis.
  const trendDates = createMemo(() => props.last30Days.map((d) => d.date.slice(5)))
  const [dailyRange, setDailyRange] = createSignal<7 | 14 | 30>(7)
  const cycleRange = () => setDailyRange((r) => (r === 7 ? 14 : r === 14 ? 30 : 7))
  const { open, toggle } = useCollapsibleGroup(OVERVIEW_SECTIONS)
  useKeyboard((evt) => {
    if (evt.name === "r" && !evt.ctrl && !evt.meta) cycleRange()
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

  // Headline ratios surfaced as gauges so the cache/output balance is
  // glanceable rather than buried in the Tokens tab.
  const tk = () => g().tokens
  const cacheHit = createMemo(() => {
    const t = tk()
    const denom = t.cacheRead + t.input
    return denom > 0 ? (t.cacheRead / denom) * 100 : 0
  })
  const outputRatio = createMemo(() => {
    const t = tk()
    const denom = t.input + t.output
    return denom > 0 ? (t.output / denom) * 100 : 0
  })
  const activeSessionRatio = createMemo(() =>
    g().sessions > 0 ? ((g().sessions - g().archivedSessions) / g().sessions) * 100 : 0,
  )
  const backgroundSuccess = createMemo(() =>
    props.stats.backgroundRuns.total > 0 ? props.stats.backgroundRuns.successRate : 0,
  )
  const tokenMix = createMemo(() => [
    { label: "Input", value: tk().input, color: viz().input },
    { label: "Output", value: tk().output, color: viz().output },
    {
      label: "Cache",
      value: tk().cacheRead + tk().cacheWrite,
      color: viz().cache,
    },
    { label: "Reasoning", value: tk().reasoning, color: viz().reasoning },
  ])
  // 30-day volume histogram: first/last day labelled for the axis caption.
  const volumeBars = createMemo(() => {
    const days = props.last30Days.slice(-Math.max(2, Math.min(props.last30Days.length, chartW())))
    return days.map((d, i, arr) => ({
      value: d.tokens,
      label: i === 0 ? d.date.slice(5) : i === arr.length - 1 ? d.date.slice(5) : undefined,
    }))
  })
  const operationalStatus = createMemo<Array<{ label: string; detail: string; status: DashboardStatus }>>(() => {
    const activeDays = props.stats.days.filter((day) => day.tokens > 0 || day.messages > 0 || day.cost > 0).length
    const toolSuccess = weightedToolSuccess(props.stats.toolUsage)
    const bg = props.stats.backgroundRuns
    const ws = props.stats.workspaces
    return [
      {
        label: "Activity",
        detail: activeDays > 0 ? `${activeDays} active days in the loaded range` : "No recorded activity yet",
        status: activeDays > 0 ? "success" : "info",
      },
      {
        label: "Tools",
        detail:
          props.stats.toolUsage.total > 0 ? `${toolSuccess.toFixed(1)}% weighted success` : "No tool calls recorded",
        status:
          props.stats.toolUsage.total === 0
            ? "info"
            : toolSuccess >= 90
              ? "success"
              : toolSuccess >= 70
                ? "warning"
                : "error",
      },
      {
        label: "Background",
        detail:
          bg.total === 0
            ? "No background runs"
            : `${bg.completed} completed · ${bg.running} running · ${bg.error} failed`,
        status: bg.error > 0 ? "error" : bg.running > 0 ? "info" : bg.total > 0 ? "success" : "info",
      },
      {
        label: "Workspaces",
        detail: ws.total === 0 ? "No workspaces connected" : `${ws.active} active · ${ws.disconnected} disconnected`,
        status: ws.disconnected > 0 ? (ws.active === 0 ? "error" : "warning") : ws.active > 0 ? "success" : "info",
      },
    ]
  })

  return (
    <box flexDirection="column" gap={2}>
      <DataSourceBanner
        stats={props.stats}
        source={props.source}
        refreshedAt={props.refreshedAt}
        historyLoading={props.historyLoading}
      />

      {/* KPI Cards — each carries a 14-cell sparkline + 7-day delta. Wrap so
          the four cards reflow to 2×2 instead of overflowing on narrow
          terminals. */}
      <box flexDirection="row" gap={2} flexWrap="wrap">
        <KPICard
          label="SESSIONS"
          value={g().sessions.toString()}
          color={viz().series[0]!}
          subtitle={`${g().sessions - g().archivedSessions} unarchived`}
          sparkline={sessionsSpark()}
          delta={{ pct: sessionsDelta().pct }}
          width={cardW()}
        />
        <KPICard
          label="MESSAGES"
          value={formatTokens(g().messages)}
          color={viz().series[1]!}
          sparkline={messagesSpark()}
          delta={{ pct: messagesDelta().pct }}
          width={cardW()}
        />
        <KPICard
          label="COST"
          value={money.format(g().cost)}
          color={viz().series[2]!}
          subtitle={`${g().efficiency.costPer1kTokens.toFixed(4)}/1k`}
          sparkline={costSpark()}
          delta={{ pct: costDelta().pct, inverse: true }}
          width={cardW()}
        />
        <KPICard
          label="TOKENS"
          value={formatTokens(g().tokens.input + g().tokens.output + g().tokens.reasoning)}
          color={viz().series[3]!}
          subtitle={`in ${formatTokens(g().tokens.input)} · out ${formatTokens(g().tokens.output)}`}
          sparkline={tokensSpark()}
          delta={{ pct: tokensDelta().pct }}
          width={cardW()}
        />
      </box>

      {/* 30-day volume histogram + headline ratio gauges — an at-a-glance
          graphical summary above the collapsible deep-dives. */}
      <Show when={volumeBars().length > 1 && volumeBars().some((bar) => bar.value > 0)}>
        <box flexDirection="column" gap={1}>
          <text fg={theme.foreground.muted} wrapMode="none">
            Tokens / day · last {volumeBars().length} days
          </text>
          <VerticalBarChart bars={volumeBars()} height={6} color={viz().input} highlightMax showAxis />
        </box>
      </Show>
      <Show when={props.last30Days.some((day) => day.cost > 0)}>
        <box flexDirection="column" gap={1}>
          <text fg={theme.foreground.muted} wrapMode="none">
            Cost / day · last {props.last30Days.length} days
          </text>
          <BrailleAreaChart
            data={props.last30Days.map((day) => day.cost)}
            width={chartW()}
            height={4}
            color={viz().output}
          />
        </box>
      </Show>

      <box flexDirection="column" gap={1}>
        <text fg={theme.foreground.default} attributes={TextAttributes.BOLD} wrapMode="none">
          Usage composition
        </text>
        <StackedBarChartV2 segments={tokenMix()} width={chartW()} showLabels />
      </box>

      <text fg={theme.foreground.default} attributes={TextAttributes.BOLD} wrapMode="none">
        Efficiency gauges
      </text>
      <box flexDirection="row" gap={4} flexWrap="wrap">
        <Show when={tk().cacheRead + tk().input > 0}>
          <Gauge
            label="Cache hit ratio"
            value={cacheHit()}
            max={100}
            width={gaugeW()}
            color={viz().cache}
            format={(v) => v.toFixed(0)}
            unit="%"
          />
        </Show>
        <Show when={tk().input + tk().output > 0}>
          <Gauge
            label="Output / (in+out)"
            value={outputRatio()}
            max={100}
            width={gaugeW()}
            color={viz().output}
            format={(v) => v.toFixed(0)}
            unit="%"
          />
        </Show>
        <Show when={g().sessions > 0}>
          <Gauge
            label="Unarchived sessions"
            value={activeSessionRatio()}
            max={100}
            width={gaugeW()}
            color={viz().input}
            format={(v) => v.toFixed(0)}
            unit="%"
          />
        </Show>
        <Show when={props.stats.backgroundRuns.total > 0}>
          <Gauge
            label="Background success"
            value={backgroundSuccess()}
            max={100}
            width={gaugeW()}
            color={backgroundSuccess() >= 90 ? viz().cache : backgroundSuccess() >= 70 ? viz().output : viz().alert}
            format={(v) => v.toFixed(0)}
            unit="%"
          />
        </Show>
      </box>

      <box flexDirection="column" gap={1}>
        <text fg={theme.foreground.default} attributes={TextAttributes.BOLD} wrapMode="none">
          Operational health
        </text>
        <AnalyticsStatusGrid items={operationalStatus()} />
      </box>

      {/* Activity Heatmap (GitHub-style) */}
      <CollapsibleSection
        title="Activity"
        hint="(responsive history window)"
        open={open().activity}
        onToggle={() => toggle("activity")}
      >
        <ActivityHeatmap stats={props.stats} />
      </CollapsibleSection>

      {/* Braille Line Chart - Token Usage Over Time */}
      <Show when={props.last30Days.some((day) => day.tokens > 0)}>
        <CollapsibleSection
          title="Token Usage Over Time"
          hint="(30 days)"
          open={open().trend}
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
              {
                label: "Reasoning",
                data: props.last30Days.map((d) => d.reasoning),
                color: viz().reasoning,
              },
            ]}
            xLabels={trendDates()}
            width={chartW()}
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
          onToggle={() => toggle("daily")}
        >
          <For each={dailyDays()}>
            {(day) => {
              const isPeak = () => day.tokens > 0 && day.tokens === dailyMax()
              const segments = [
                { label: "Input", value: day.input, color: viz().input },
                { label: "Output", value: day.output, color: viz().output },
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
              ]
              return (
                <Show
                  when={!layout().compact}
                  fallback={
                    <box flexDirection="column" gap={0}>
                      <box flexDirection="row" gap={2} alignItems="center" justifyContent="space-between">
                        <text
                          fg={isPeak() ? theme.accent.fg : theme.foreground.muted}
                          attributes={isPeak() ? TextAttributes.BOLD : undefined}
                          wrapMode="none"
                        >
                          {day.date.slice(5)}
                        </text>
                        <text fg={theme.foreground.muted} wrapMode="none">
                          {formatTokens(day.tokens)} · {day.cost > 0 ? money.format(day.cost) : "—"}
                        </text>
                      </box>
                      <StackedBarChartV2 segments={segments} width={chartW()} showLabels={false} />
                    </box>
                  }
                >
                  <box flexDirection="row" gap={2} alignItems="center">
                    <text
                      fg={isPeak() ? theme.accent.fg : theme.foreground.muted}
                      attributes={isPeak() ? TextAttributes.BOLD : undefined}
                      width={6}
                      wrapMode="none"
                    >
                      {day.date.slice(5)}
                    </text>
                    <StackedBarChartV2 segments={segments} width={dailyBarW()} showLabels={false} />
                    <text fg={theme.foreground.muted} width={8} wrapMode="none">
                      {formatTokens(day.tokens).padStart(8)}
                    </text>
                    <text fg={theme.status.success.fg} width={9} wrapMode="none">
                      {(day.cost > 0 ? money.format(day.cost) : "—").padStart(9)}
                    </text>
                  </box>
                </Show>
              )
            }}
          </For>
          <Show when={dailyDays().every((d) => d.tokens === 0)}>
            <EmptyState icon="▦" message="No usage in this range" />
          </Show>
          {/* Legend + range control */}
          <box flexDirection="row" gap={3} alignItems="center" flexWrap="wrap">
            <LegendDot color={viz().input} label="Input" />
            <LegendDot color={viz().output} label="Output" />
            <LegendDot color={viz().cache} label="Cache" />
            <LegendDot color={viz().reasoning} label="Reason" />
            <text fg={theme.foreground.muted} onMouseUp={() => cycleRange()} wrapMode="none">
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
        onToggle={() => toggle("providers")}
      >
        <For each={Array.from(props.stats.providers.values()).slice(0, 5)}>
          {(prov) => (
            <box flexDirection="row" gap={2} alignItems="center" flexWrap="wrap">
              <text fg={theme.accent.fg} width={layout().compact ? 10 : 12} wrapMode="none">
                {prov.providerID}
              </text>
              <text fg={theme.foreground.muted} width={layout().compact ? 10 : 14} wrapMode="none">
                {prov.sessions}s / {prov.messages}m
              </text>
              <text fg={theme.status.success.fg} wrapMode="none">
                {money.format(prov.cost)}
              </text>
            </box>
          )}
        </For>
        {/* Cost share across providers as one proportional bar. */}
        <Show when={props.stats.providers.size > 1}>
          <box paddingTop={1} flexDirection="column" gap={1}>
            <text fg={theme.foreground.muted} wrapMode="none">
              Cost share
            </text>
            <StackedBarChartV2
              segments={Array.from(props.stats.providers.values())
                .slice(0, 6)
                .map((p, i) => ({
                  label: p.providerID,
                  value: p.cost,
                  color: viz().series[i % viz().series.length]!,
                }))}
              width={Math.max(6, chartW() - 2)}
              showLabels
            />
          </box>
        </Show>
        <Show when={props.stats.providers.size === 0}>
          <EmptyState message="No provider data" />
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
  const { open, toggle } = useCollapsibleGroup(TOKENS_SECTIONS)
  const chartW = useChartWidth(64)
  const dimensions = useTerminalDimensions()
  const layout = createMemo(() => computeAnalyticsDialogLayout(dimensions().width, dimensions().height))
  // HBarPrecision draws label(10) + bar + value + pct columns, so leave ~26
  // cols of headroom around the bar itself.
  const barW = createMemo(() =>
    layout().compact ? Math.max(4, chartW() - 17) : Math.max(6, Math.min(30, chartW() - 26)),
  )
  const cacheHit = createMemo(() => {
    const t = tokens()
    const denom = t.cacheRead + t.input
    return denom > 0 ? (t.cacheRead / denom) * 100 : 0
  })
  const tokenBars = createMemo(() => {
    const days = props.last14Days.slice(-Math.max(2, Math.min(props.last14Days.length, chartW())))
    return days.map((d, i, arr) => ({
      value: d.tokens,
      label: i === 0 ? d.date.slice(5) : i === arr.length - 1 ? d.date.slice(5) : undefined,
    }))
  })

  return (
    <box flexDirection="column" gap={2}>
      <TabHeading
        icon="▦"
        title="Token economics"
        description="Composition, cache effectiveness, daily trend and cost efficiency."
        meta={`${formatTokens(totalWithCache())} incl. cache`}
      />

      {/* Token Breakdown Bars with 8-level precision */}
      <CollapsibleSection title="Token Breakdown" open={open().breakdown} onToggle={() => toggle("breakdown")}>
        <HBarPrecision
          label="input"
          value={tokens().input}
          max={total()}
          width={barW()}
          color={viz().input}
          showPct={!layout().compact}
        />
        <HBarPrecision
          label="output"
          value={tokens().output}
          max={total()}
          width={barW()}
          color={viz().output}
          showPct={!layout().compact}
        />
        <HBarPrecision
          label="reasoning"
          value={tokens().reasoning}
          max={total()}
          width={barW()}
          color={viz().reasoning}
          showPct={!layout().compact}
        />
        <HBarPrecision
          label="cache-read"
          value={tokens().cacheRead}
          max={totalWithCache()}
          width={barW()}
          color={viz().cache}
          showPct={!layout().compact}
        />
        <HBarPrecision
          label="cache-write"
          value={tokens().cacheWrite}
          max={totalWithCache()}
          width={barW()}
          color={viz().cacheWrite}
          showPct={!layout().compact}
        />
        {/* Cache effectiveness gauge — cache reads vs fresh input. */}
        <box paddingTop={1}>
          <Show when={tokens().cacheRead + tokens().input > 0}>
            <Gauge
              label="Cache hit ratio"
              value={cacheHit()}
              max={100}
              width={Math.max(6, chartW() - 6)}
              color={viz().cache}
              format={(v) => v.toFixed(0)}
              unit="%"
            />
          </Show>
        </box>
      </CollapsibleSection>

      {/* Braille Area Chart + column histogram for token trend */}
      <Show when={props.last14Days.some((day) => day.tokens > 0)}>
        <CollapsibleSection title="14-Day Token Trend" open={open().trend} onToggle={() => toggle("trend")}>
          <BrailleAreaChart
            data={props.last14Days.map((d) => d.tokens)}
            width={chartW()}
            height={4}
            color={viz().input}
          />
          <box paddingTop={1}>
            <VerticalBarChart bars={tokenBars()} height={6} color={viz().input} highlightMax showAxis />
          </box>
        </CollapsibleSection>
      </Show>

      {/* Efficiency Metrics */}
      <CollapsibleSection title="Efficiency Metrics" open={open().efficiency} onToggle={() => toggle("efficiency")}>
        <box flexDirection="row" gap={3} flexWrap="wrap">
          <box flexDirection="column" gap={0}>
            <text fg={theme.foreground.muted}>Cost/1K tokens</text>
            <text fg={colorToString(theme.status.success.fg)} attributes={TextAttributes.BOLD}>
              ${g().efficiency.costPer1kTokens.toFixed(4)}
            </text>
          </box>
          <box flexDirection="column" gap={0}>
            <text fg={theme.foreground.muted}>Cost/session</text>
            <text fg={colorToString(theme.status.success.fg)} attributes={TextAttributes.BOLD}>
              {money.format(g().efficiency.costPerSession)}
            </text>
          </box>
          <box flexDirection="column" gap={0}>
            <text fg={theme.foreground.muted}>Tokens/session</text>
            <text fg={viz().input} attributes={TextAttributes.BOLD}>
              {formatTokens(g().efficiency.avgTokensPerSession)}
            </text>
          </box>
          <box flexDirection="column" gap={0}>
            <text fg={theme.foreground.muted}>Avg cost/day</text>
            <text fg={colorToString(theme.status.warning.fg)} attributes={TextAttributes.BOLD}>
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
  const chartW = useChartWidth(64)
  const dimensions = useTerminalDimensions()
  const layout = createMemo(() => computeAnalyticsDialogLayout(dimensions().width, dimensions().height))
  const models = createMemo(() => props.stats.models.slice(0, 8))
  const shareSegments = createMemo(() =>
    models().map((m, i) => ({
      label: m.modelID.length > 12 ? m.modelID.slice(-12) : m.modelID,
      value: m.tokens.input + m.tokens.output + m.tokens.reasoning,
      color: viz().series[i % viz().series.length]!,
    })),
  )
  // Split-bar total width: name(18) + value(8) + 4 gaps leave the rest.
  const nameW = createMemo(() => (layout().compact ? 8 : 18))
  const splitW = createMemo(() => Math.max(4, Math.min(30, chartW() - nameW() - 10)))
  const modelBarW = createMemo(() => Math.max(4, Math.min(20, chartW() - 18)))

  return (
    <box flexDirection="column" gap={1}>
      <TabHeading
        icon="◆"
        title="Model portfolio"
        description="Token share, request volume and per-model input/output/cache composition."
        meta={`${props.stats.models.length} models`}
      />

      {/* Token share across top models — one proportional bar. */}
      <Show when={models().length > 1}>
        <box flexDirection="column" gap={1}>
          <text fg={theme.foreground.muted} wrapMode="none">
            Token share
          </text>
          <StackedBarChartV2 segments={shareSegments()} width={chartW()} showLabels />
        </box>
      </Show>

      <For each={models()}>
        {(model) => (
          <ModelCard
            name={
              model.modelID.length > chartW() - 4
                ? "…" + model.modelID.slice(-Math.max(4, chartW() - 5))
                : model.modelID
            }
            provider={model.providerID}
            requests={model.messages}
            inputTokens={model.tokens.input}
            outputTokens={model.tokens.output}
            reasoningTokens={model.tokens.reasoning}
            cacheReadTokens={model.tokens.cacheRead}
            cacheWriteTokens={model.tokens.cacheWrite}
            color={viz().series[4]!}
            barWidth={modelBarW()}
          />
        )}
      </For>

      <Show when={props.stats.models.length === 0}>
        <EmptyState icon="◆" message="No model usage data" />
      </Show>

      {/* Compact aggregate view: 14-day daily usage per top model, with
          input vs output split bars so the input/output ratio is visible
          at a glance (per-model). */}
      <Show when={models().length > 0}>
        <text fg={theme.foreground.default} attributes={TextAttributes.BOLD}>
          Daily Usage Split
        </text>
        <For each={models()}>
          {(model) => {
            const totalNonCache = model.tokens.input + model.tokens.output + model.tokens.reasoning
            const w = splitW()
            const inShare = totalNonCache > 0 ? model.tokens.input / totalNonCache : 0
            const outShare = totalNonCache > 0 ? model.tokens.output / totalNonCache : 0
            const inWidth = Math.max(0, Math.round(inShare * w))
            const outWidth = Math.max(0, Math.round(outShare * w))
            const reasWidth = Math.max(0, w - inWidth - outWidth)
            return (
              <box flexDirection="row" gap={1} alignItems="center">
                <text fg={theme.foreground.default} width={nameW()} wrapMode="none">
                  {(model.modelID.length > nameW() ? "…" + model.modelID.slice(-(nameW() - 1)) : model.modelID).padEnd(
                    nameW(),
                  )}
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
                <text fg={theme.foreground.muted} width={8} wrapMode="none">
                  {formatTokens(totalNonCache).padStart(8)}
                </text>
              </box>
            )
          }}
        </For>
        {/* Legend */}
        <box flexDirection="row" gap={3} flexWrap="wrap">
          <box flexDirection="row" gap={1} alignItems="center">
            <text fg={viz().input} wrapMode="none">
              ■
            </text>
            <text fg={theme.foreground.muted}>Input</text>
          </box>
          <box flexDirection="row" gap={1} alignItems="center">
            <text fg={viz().output} wrapMode="none">
              ■
            </text>
            <text fg={theme.foreground.muted}>Output</text>
          </box>
          <box flexDirection="row" gap={1} alignItems="center">
            <text fg={viz().reasoning} wrapMode="none">
              ■
            </text>
            <text fg={theme.foreground.muted}>Reasoning</text>
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

  const chartW = useChartWidth(60)
  const dimensions = useTerminalDimensions()
  const layout = createMemo(() => computeAnalyticsDialogLayout(dimensions().width, dimensions().height))
  const nameW = createMemo(() => (layout().compact ? 8 : 18))
  const rankedBarW = createMemo(() => Math.max(4, chartW() - nameW() - 10))
  const vcsStats = createMemo(() => {
    const git = props.stats.projects.filter((p) => p.vcs === "git").length
    const local = props.stats.projects.filter((p) => p.vcs === "local" || p.vcs === "unknown").length
    return { git, local, total: props.stats.projects.length }
  })
  // Top projects by token volume, ranked, for the bar list.
  const topProjects = createMemo(() =>
    [...props.stats.projects]
      .sort((a, b) => b.totalTokens - a.totalTokens)
      .slice(0, 8)
      .map((p) => ({ name: p.name, value: p.totalTokens })),
  )

  return (
    <box flexDirection="column" gap={1}>
      <TabHeading
        icon="▣"
        title="Project distribution"
        description="Where sessions, token volume and spend are concentrated."
        meta={`${g().projects.length} projects`}
      />

      {/* VCS Breakdown — text summary + proportional stacked bar so the
          git-vs-local mix is visible at a glance (was a flat row of
          numbers before). */}
      <box flexDirection="row" gap={3} flexWrap="wrap">
        <box flexDirection="row" gap={1} alignItems="center">
          <text fg={theme.foreground.muted}>Git:</text>
          <text fg={colorToString(theme.status.success.fg)} attributes={TextAttributes.BOLD}>
            {vcsStats().git}
          </text>
        </box>
        <box flexDirection="row" gap={1} alignItems="center">
          <text fg={theme.foreground.muted}>Local:</text>
          <text fg={theme.foreground.muted} attributes={TextAttributes.BOLD}>
            {vcsStats().local}
          </text>
        </box>
        <box flexDirection="row" gap={1} alignItems="center">
          <text fg={theme.foreground.muted}>Avg sessions:</text>
          <text fg={colorToString(theme.accent.fg)} attributes={TextAttributes.BOLD}>
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
          width={chartW()}
          showLabels
        />
      </Show>

      {/* Top projects by token volume — ranked bars. */}
      <Show when={topProjects().length > 1}>
        <box flexDirection="column" gap={1} paddingTop={1}>
          <text fg={theme.foreground.muted} wrapMode="none">
            Top projects · tokens
          </text>
          <RankedBarList
            items={topProjects()}
            nameWidth={nameW()}
            barWidth={rankedBarW()}
            formatValue={(v) => formatTokens(v)}
          />
        </box>
      </Show>

      {/* Project Cards */}
      <box flexDirection="column" gap={0}>
        <For each={props.stats.projects.slice(0, 8)}>
          {(proj) => (
            <box
              flexDirection="row"
              gap={2}
              alignItems="center"
              flexWrap="wrap"
              border={["bottom"]}
              borderColor={theme.border.subtle}
              paddingLeft={1}
              paddingRight={1}
            >
              <text
                fg={proj.vcs === "git" ? theme.status.success.fg : theme.foreground.muted}
                width={2}
                wrapMode="none"
              >
                {proj.vcs === "git" ? "●" : "○"}
              </text>
              <text fg={theme.foreground.default} width={nameW()} wrapMode="none">
                {proj.name.length > nameW() ? "…" + proj.name.slice(-(nameW() - 1)) : proj.name}
              </text>
              <text fg={theme.foreground.muted}>{proj.sessionCount}s</text>
              <text fg={theme.accent.fg}>{formatTokens(proj.totalTokens)}</text>
              <text fg={theme.status.success.fg}>{money.format(proj.totalCost)}</text>
            </box>
          )}
        </For>
      </box>

      <Show when={props.stats.projects.length === 0}>
        <EmptyState icon="▣" message="No projects yet" />
      </Show>
    </box>
  )
}

function ToolsTab(props: { stats: AggregatedStats }) {
  const { theme } = useTheme()
  const tools = () => props.stats.toolUsage
  const chartW = useChartWidth(60)
  const dimensions = useTerminalDimensions()
  const layout = createMemo(() => computeAnalyticsDialogLayout(dimensions().width, dimensions().height))
  const nameW = createMemo(() => (layout().compact ? 8 : 18))
  const barW = createMemo(() => Math.max(4, chartW() - nameW() - (layout().compact ? 10 : 16)))
  const successColor = (rate: number): RGBA => {
    if (rate >= 90) return theme.status.success.fg
    if (rate >= 70) return theme.status.warning.fg
    return theme.status.error.fg
  }
  // Call-weighted overall success rate across every tracked tool.
  const overallSuccess = createMemo(() => weightedToolSuccess(tools()))

  return (
    <box flexDirection="column" gap={1}>
      <TabHeading
        icon="✦"
        title="Tool reliability"
        description="Call volume and call-weighted success, colored by reliability threshold."
        meta={`${formatCompact(tools().total)} calls`}
      />

      {/* Overall call-weighted success gauge — recolors warning/error as the
          aggregate reliability drops. */}
      <Show when={tools().total > 0}>
        <Gauge
          label="Overall success rate"
          value={overallSuccess()}
          max={100}
          width={Math.max(6, chartW() - 6)}
          format={(v) => v.toFixed(1)}
          unit="%"
          color={successColor(overallSuccess())}
        />
      </Show>

      {/* Ranked list with 1/8-cell bar precision. Each bar uses the bar's
          color (theme.status.success.fg/warning/error) so visual "danger" is encoded
          in the bar itself, not only in the trailing percent column. */}
      <RankedBarList
        items={tools()
          .mostUsed.slice(0, 10)
          .map((t) => ({
            name: t.name,
            value: t.count,
            subValue: layout().compact ? undefined : `${t.successRate.toFixed(0)}%`,
            color: successColor(t.successRate),
          }))}
        nameWidth={nameW()}
        barWidth={barW()}
        formatValue={(v) => formatCompact(v)}
      />

      <Show when={tools().mostUsed.length === 0}>
        <EmptyState icon="✦" message="No tool usage data" />
      </Show>

      {/* Legend */}
      <box flexDirection="row" gap={3} flexWrap="wrap">
        <box flexDirection="row" gap={1} alignItems="center">
          <text fg={colorToString(theme.status.success.fg)} wrapMode="none">
            ■
          </text>
          <text fg={theme.foreground.muted}>90%+ success</text>
        </box>
        <box flexDirection="row" gap={1} alignItems="center">
          <text fg={colorToString(theme.status.warning.fg)} wrapMode="none">
            ■
          </text>
          <text fg={theme.foreground.muted}>70-90%</text>
        </box>
        <box flexDirection="row" gap={1} alignItems="center">
          <text fg={colorToString(theme.status.error.fg)} wrapMode="none">
            ■
          </text>
          <text fg={theme.foreground.muted}>&lt;70%</text>
        </box>
      </box>
    </box>
  )
}

const SESSIONS_SECTIONS = [
  "sessions",
  "duration",
  "recent",
  "top",
  "background",
  "agents",
  "todos",
  "workspaces",
] as const

function SessionsTab(props: { stats: AggregatedStats }) {
  const { theme } = useTheme()
  const viz = () => getChartColors(theme)
  const g = () => props.stats.global
  const ws = () => props.stats.workspaces
  const topSessions = createMemo(() => props.stats.sessions.slice(0, 5))
  const bg = () => props.stats.backgroundRuns
  const chartW = useChartWidth(48)
  const dimensions = useTerminalDimensions()
  const layout = createMemo(() => computeAnalyticsDialogLayout(dimensions().width, dimensions().height))
  const nameW = createMemo(() => (layout().compact ? 8 : 18))
  const rankedBarW = createMemo(() => Math.max(4, chartW() - nameW() - 12))
  const durationBins = createMemo(() => buildDurationHistogram(props.stats.sessions))
  const todo = () => props.stats.todos
  const { open, toggle } = useCollapsibleGroup(SESSIONS_SECTIONS)

  return (
    <box flexDirection="column" gap={2}>
      <TabHeading
        icon="⊞"
        title="Session operations"
        description="Lifecycle, duration, recency, background execution and workspace state."
        meta={`${g().sessions} sessions`}
      />

      {/* Session Stats */}
      <CollapsibleSection
        title="Sessions"
        hint={`(${g().sessions})`}
        open={open().sessions}
        onToggle={() => toggle("sessions")}
      >
        <box flexDirection="row" gap={3} flexWrap="wrap">
          <box flexDirection="row" gap={1} alignItems="center">
            <text fg={theme.foreground.muted}>Total:</text>
            <text fg={colorToString(theme.accent.fg)} attributes={TextAttributes.BOLD}>
              {g().sessions}
            </text>
          </box>
          <box flexDirection="row" gap={1} alignItems="center">
            <text fg={theme.foreground.muted}>Unarchived:</text>
            <text fg={colorToString(theme.status.success.fg)} attributes={TextAttributes.BOLD}>
              {g().sessions - g().archivedSessions}
            </text>
          </box>
          <box flexDirection="row" gap={1} alignItems="center">
            <text fg={theme.foreground.muted}>Archived:</text>
            <text fg={theme.foreground.muted} attributes={TextAttributes.BOLD}>
              {g().archivedSessions}
            </text>
          </box>
        </box>
      </CollapsibleSection>

      <CollapsibleSection
        title="Duration Distribution"
        hint={`(${props.stats.sessions.length} measured)`}
        open={open().duration}
        onToggle={() => toggle("duration")}
      >
        <Show when={props.stats.sessions.length > 0} fallback={<EmptyState message="No session duration data" />}>
          <AnalyticsHistogram bins={durationBins()} width={chartW()} color={viz().input} />
        </Show>
      </CollapsibleSection>

      <CollapsibleSection
        title="Recent Activity"
        hint="(latest updates)"
        open={open().recent}
        onToggle={() => toggle("recent")}
      >
        <RecentSessionTimeline sessions={props.stats.sessions} />
      </CollapsibleSection>

      {/* Top Sessions */}
      <CollapsibleSection title="Top by Tokens" open={open().top} onToggle={() => toggle("top")}>
        <RankedBarList
          items={topSessions().map((session) => ({
            name: session.title || "Untitled session",
            value: session.tokens.input + session.tokens.output + session.tokens.reasoning,
            subValue: layout().compact ? undefined : money.format(session.cost),
            color: viz().input,
          }))}
          nameWidth={nameW()}
          barWidth={rankedBarW()}
          formatValue={(value) => formatTokens(value)}
        />
        <Show when={topSessions().length === 0}>
          <EmptyState message="No sessions yet" />
        </Show>
      </CollapsibleSection>

      {/* Background Runs */}
      <CollapsibleSection
        title="Background Runs"
        hint={`(${bg().total})`}
        open={open().background}
        onToggle={() => toggle("background")}
      >
        <Show when={bg().total > 0} fallback={<EmptyState message="No background runs" />}>
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
            width={chartW()}
            showLabels
          />
          <box flexDirection="row" gap={3} flexWrap="wrap">
            <box flexDirection="row" gap={1} alignItems="center">
              <text fg={theme.foreground.muted}>Success:</text>
              <text fg={colorToString(theme.status.success.fg)}>{bg().successRate.toFixed(0)}%</text>
            </box>
            <box flexDirection="row" gap={1} alignItems="center">
              <text fg={theme.foreground.muted}>Avg duration:</text>
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
          open={open().agents}
          onToggle={() => toggle("agents")}
        >
          <RankedBarList
            items={bg().topAgents.map((a) => ({
              name: a.agent,
              value: a.count,
              color: viz().input,
            }))}
            nameWidth={nameW()}
            barWidth={rankedBarW()}
            formatValue={(v) => formatCompact(v)}
          />
        </CollapsibleSection>
      </Show>

      <CollapsibleSection
        title="Task Progress"
        hint={`(${todo().total} todos)`}
        open={open().todos}
        onToggle={() => toggle("todos")}
      >
        <Show when={todo().total > 0} fallback={<EmptyState message="No todos recorded" />}>
          <Gauge
            label="Completion rate"
            value={todo().completionRate}
            max={100}
            width={Math.max(6, chartW() - 6)}
            color={viz().cache}
            format={(value) => value.toFixed(0)}
            unit="%"
          />
          <StackedBarChartV2
            segments={[
              { label: "Done", value: todo().completed, color: viz().cache },
              { label: "Active", value: todo().inProgress, color: viz().input },
              { label: "Pending", value: todo().pending, color: viz().output },
              {
                label: "Cancelled",
                value: todo().cancelled,
                color: viz().reasoning,
              },
            ]}
            width={chartW()}
            showLabels
          />
        </Show>
      </CollapsibleSection>

      {/* Workspaces Summary */}
      <CollapsibleSection
        title="Workspaces"
        hint={`(${ws().total})`}
        open={open().workspaces}
        onToggle={() => toggle("workspaces")}
      >
        <box flexDirection="row" gap={3} flexWrap="wrap">
          <box flexDirection="row" gap={1} alignItems="center">
            <text fg={theme.foreground.muted}>Total:</text>
            <text fg={colorToString(theme.accent.fg)}>{ws().total}</text>
          </box>
          <box flexDirection="row" gap={1} alignItems="center">
            <text fg={theme.foreground.muted}>Active:</text>
            <text fg={colorToString(theme.status.success.fg)}>{ws().active}</text>
          </box>
          <box flexDirection="row" gap={1} alignItems="center">
            <text fg={theme.foreground.muted}>Disconnected:</text>
            <text fg={colorToString(theme.status.error.fg)}>{ws().disconnected}</text>
          </box>
        </box>

        {/* Type breakdown */}
        <Show when={Object.keys(ws().byType).length > 0}>
          <text fg={theme.foreground.muted}>By type:</text>
          <box flexDirection="row" gap={2} flexWrap="wrap">
            <For each={Object.entries(ws().byType)}>
              {([type, count]) => (
                <box flexDirection="row" gap={1} alignItems="center">
                  <text fg={colorToString(theme.accent.alt)}>{type}:</text>
                  <text fg={theme.foreground.default}>{count}</text>
                </box>
              )}
            </For>
          </box>
        </Show>
      </CollapsibleSection>
    </box>
  )
}
