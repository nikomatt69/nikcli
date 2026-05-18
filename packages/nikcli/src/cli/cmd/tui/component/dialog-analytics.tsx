import { TextAttributes } from "@opentui/core"
import { useTheme } from "../context/theme"
import { useSync } from "@tui/context/sync"
import { useSDK } from "@tui/context/sdk"
import { useAnalytics } from "../context/analytics"
import { useKeyboard } from "@opentui/solid"
import { For, Show, createSignal, createMemo, onMount } from "solid-js"
import {
  aggregateAnalytics,
  mergeWithHistorical,
  mergeSessionsFromApi,
  augmentAggregatedStatsFromPersistedSessions,
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
  getChartColors,
} from "./chart-braille-line"

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
const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })

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

export function DialogAnalytics(props: { onClose: () => void }) {
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
            stats = { ...stats, sessions: mergeSessionsFromApi(stats.sessions, persistedSessions) }
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
  const totalNonCache = createMemo(() => {
    const s = stats()?.global.tokens
    if (!s) return 0
    return s.input + s.output + s.reasoning
  })

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
        <text fg={theme.textMuted}>←→ or click tabs | esc to close</text>
      </box>

      <Show when={loading()}>
        <text fg={theme.textMuted}>Loading analytics...</text>
      </Show>

      <Show when={!loading() && stats()}>
        {/* Tab Bar */}
        <box flexDirection="row" gap={2}>
          <For each={TABS}>
            {(tab) => (
              <text
                fg={activeTab() === tab.id ? theme.primary : theme.textMuted}
                attributes={activeTab() === tab.id ? TextAttributes.BOLD : undefined}
                onMouseUp={() => setActiveTab(tab.id)}
              >
                {activeTab() === tab.id ? "[" : " "}
                {tab.label}
                {activeTab() === tab.id ? "]" : " "}
              </text>
            )}
          </For>
        </box>

        <text fg={theme.border} wrapMode="none">
          {BOX.horizontal.repeat(60)}
        </text>

        {/* Tab Content */}
        <Show when={activeTab() === "overview"}>
          <OverviewTab stats={stats()!} last14Days={last14Days()} last30Days={last30Days()} />
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

// ===== TAB COMPONENTS =====

function OverviewTab(props: {
  stats: AggregatedStats
  last14Days: typeof props.stats.days
  last30Days: typeof props.stats.days
}) {
  const { theme } = useTheme()
  const g = () => props.stats.global
  const viz = () => getChartColors(theme)

  return (
    <box flexDirection="column" gap={2}>
      {/* KPI Cards */}
      <box flexDirection="row" gap={2}>
        <KPICard
          label="SESSIONS"
          value={g().sessions.toString()}
          color={viz().series[0]!}
          subtitle={`${g().sessions - g().archivedSessions} active`}
        />
        <KPICard label="MESSAGES" value={formatTokens(g().messages)} color={viz().series[1]!} />
        <KPICard
          label="COST"
          value={money.format(g().cost)}
          color={viz().series[2]!}
          subtitle={`$${g().efficiency.costPer1kTokens.toFixed(4)}/1k tokens`}
        />
        <KPICard
          label="TOKENS"
          value={formatTokens(g().tokens.input + g().tokens.output + g().tokens.reasoning)}
          color={viz().series[3]!}
          subtitle={`in:${formatTokens(g().tokens.input)} out:${formatTokens(g().tokens.output)}`}
        />
      </box>

      {/* Braille Line Chart - Token Usage Over Time */}
      <Show when={props.last30Days.length > 0}>
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          Token Usage Over Time (30 days)
        </text>
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
      </Show>

      {/* Daily Stacked Bar Chart */}
      <Show when={props.last14Days.length > 0}>
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          Daily Token Breakdown (14 days)
        </text>
        <For each={props.last14Days.slice(-7)}>
          {(day) => (
            <box flexDirection="row" gap={2} alignItems="center">
              <text fg={theme.textMuted} width={6} wrapMode="none">
                {day.date.slice(5)}
              </text>
              <StackedBarChartV2
                segments={[
                  { label: "Input", value: day.input, color: viz().input },
                  { label: "Output", value: day.output, color: viz().output },
                  { label: "Cache", value: day.cacheRead + day.cacheWrite, color: viz().cache },
                  { label: "Reason", value: day.reasoning, color: viz().reasoning },
                ]}
                width={30}
                showLabels={false}
              />
              <text fg={theme.textMuted}>{formatTokens(day.tokens)}</text>
            </box>
          )}
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
            <text fg={viz().cache} wrapMode="none">
              ■
            </text>
            <text fg={theme.textMuted}>Cache</text>
          </box>
          <box flexDirection="row" gap={1} alignItems="center">
            <text fg={viz().reasoning} wrapMode="none">
              ■
            </text>
            <text fg={theme.textMuted}>Reason</text>
          </box>
        </box>
      </Show>

      {/* Provider Summary */}
      <box flexDirection="column" gap={0}>
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          Top Providers
        </text>
        <For each={Array.from(props.stats.providers.values()).slice(0, 3)}>
          {(prov) => (
            <box flexDirection="row" gap={2} alignItems="center">
              <text fg={theme.primary} width={12}>
                {prov.providerID}
              </text>
              <text fg={theme.textMuted}>
                {prov.sessions}s / {prov.messages}m
              </text>
              <text fg={theme.success}>{money.format(prov.cost)}</text>
            </box>
          )}
        </For>
      </box>
    </box>
  )
}

function TokensTab(props: { stats: AggregatedStats; last14Days: typeof props.stats.days }) {
  const { theme } = useTheme()
  const viz = () => getChartColors(theme)
  const g = () => props.stats.global
  const tokens = () => g().tokens
  const total = createMemo(() => tokens().input + tokens().output + tokens().reasoning)
  const totalWithCache = createMemo(() => total() + tokens().cacheRead + tokens().cacheWrite)

  return (
    <box flexDirection="column" gap={1}>
      {/* Token Breakdown Bars with 8-level precision */}
      <text fg={theme.text} attributes={TextAttributes.BOLD}>
        Token Breakdown
      </text>
      <box flexDirection="column" gap={0}>
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
      </box>

      {/* Braille Area Chart for token trend */}
      <Show when={props.last14Days.length > 0}>
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          14-Day Token Trend
        </text>
        <BrailleAreaChart data={props.last14Days.map((d) => d.tokens)} width={50} height={4} color={viz().input} />
      </Show>

      {/* Efficiency Metrics */}
      <text fg={theme.text} attributes={TextAttributes.BOLD}>
        Efficiency Metrics
      </text>
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
    </box>
  )
}

function ProjectsTab(props: { stats: AggregatedStats }) {
  const { theme } = useTheme()
  const g = () => props.stats.global

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

      {/* VCS Breakdown */}
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
  const viz = () => getChartColors(theme)
  const tools = () => props.stats.toolUsage
  const maxCount = createMemo(() => tools().mostUsed[0]?.count ?? 1)

  return (
    <box flexDirection="column" gap={1}>
      <text fg={theme.text} attributes={TextAttributes.BOLD}>
        Tool Usage ({tools().total} calls)
      </text>

      {/* Tool List with bars */}
      <box flexDirection="column" gap={0}>
        <For each={tools().mostUsed.slice(0, 10)}>
          {(tool) => {
            const barWidth = createMemo(() => Math.floor((tool.count / maxCount()) * 20))
            const successColor = createMemo(() => {
              if (tool.successRate >= 90) return colorToString(theme.success)
              if (tool.successRate >= 70) return colorToString(theme.warning)
              return colorToString(theme.error)
            })
            return (
              <box flexDirection="row" gap={1} alignItems="center">
                <text fg={theme.text} width={16} wrapMode="none">
                  {tool.name.slice(-16)}
                </text>
                <text fg={viz().input} wrapMode="none">
                  {"█".repeat(barWidth())}
                </text>
                <text fg={theme.textMuted} width={5}>
                  {tool.count}
                </text>
                <text fg={successColor()} width={5}>
                  {tool.successRate.toFixed(0)}%
                </text>
              </box>
            )
          }}
        </For>
      </box>

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

function SessionsTab(props: { stats: AggregatedStats }) {
  const { theme } = useTheme()
  const viz = () => getChartColors(theme)
  const g = () => props.stats.global
  const ws = () => props.stats.workspaces
  const topSessions = createMemo(() => props.stats.sessions.slice(0, 5))
  const bg = () => props.stats.backgroundRuns

  return (
    <box flexDirection="column" gap={1}>
      {/* Session Stats */}
      <text fg={theme.text} attributes={TextAttributes.BOLD}>
        Sessions
      </text>
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

      {/* Top Sessions */}
      <text fg={theme.text} attributes={TextAttributes.BOLD}>
        Top by Tokens
      </text>
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

      {/* Background Runs */}
      <Show when={bg().total > 0}>
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          Background Runs ({bg().total})
        </text>
        <StackedBarChartV2
          segments={[
            { label: "Completed", value: bg().completed, color: viz().cache },
            { label: "Running", value: bg().running, color: viz().input },
            { label: "Error", value: bg().error, color: viz().alert },
            { label: "Cancelled", value: bg().cancelled, color: viz().reasoning },
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

      {/* Workspaces Summary */}
      <text fg={theme.text} attributes={TextAttributes.BOLD}>
        Workspaces
      </text>
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
    </box>
  )
}
