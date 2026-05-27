import { For, Show, createMemo } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { theme, progressBar, ratioBar, sparklineChars, suiteExecColor } from "../theme"
import {
  short,
  relativeTime,
  suiteStatusIcon,
  fmtDuration,
  pct,
  type SuiteFileState,
  type SuiteGroupState,
} from "../types"

interface SuiteAggregates {
  totalFiles: number
  passing: number
  failing: number
  running: number
  notRun: number
  mixed: number
  skipped: number
  totalTests: number
  totalPassed: number
  totalFailed: number
  totalSkipped: number
  totalDurationMs: number
  passRate: number
}

interface SuiteDashboardViewProps {
  aggregates: SuiteAggregates
  files: SuiteFileState[]
  groups: SuiteGroupState[]
  runningCount: number
  queueLength: number
  onRunAll: () => void
  onRunGroup: (name: string) => void
  onRunFile: (fp: string) => void
  onFocus: () => void
  onScroll: (direction: 1 | -1) => void
}

export function SuiteDashboardView(props: SuiteDashboardViewProps) {
  const recentRuns = createMemo(() => {
    const all: { rel: string; ts: number; status: string; failed: number; passed: number; dur: number }[] = []
    for (const f of props.files) {
      for (const r of f.history) {
        all.push({
          rel: f.relativePath,
          ts: r.startedAt,
          status: r.status,
          failed: r.failed,
          passed: r.passed,
          dur: r.durationMs,
        })
      }
    }
    return all.sort((a, b) => b.ts - a.ts).slice(0, 12)
  })

  const slowest = createMemo(() => {
    return props.files
      .filter((f) => f.lastRun && f.lastRun.durationMs > 0)
      .sort((a, b) => b.lastRun!.durationMs - a.lastRun!.durationMs)
      .slice(0, 8)
  })

  const needsAttention = createMemo(() =>
    props.files
      .filter((f) => {
        const lr = f.lastRun
        return !lr || lr.status === "fail" || lr.status === "mixed" || lr.status === "running"
      })
      .slice(0, 10),
  )

  const totalExecutedFiles = createMemo(() => props.aggregates.totalFiles - props.aggregates.notRun)
  const filePassRate = createMemo(() => pct(props.aggregates.passing, Math.max(1, totalExecutedFiles())))

  const trendByFile = createMemo(() => {
    return props.files
      .filter((f) => f.history.length >= 2)
      .slice(0, 8)
      .map((f) => ({
        rel: f.relativePath,
        spark: sparklineChars(
          f.history.map((h) => h.durationMs),
          16,
        ),
        status: f.lastRun?.status ?? "notrun",
      }))
  })

  return (
    <scrollbox
      flexGrow={1}
      focusable
      onMouseOver={props.onFocus}
      rootOptions={{ flexDirection: "column" }}
      contentOptions={{ flexDirection: "column", gap: 0 }}
      scrollbarOptions={{ visible: true }}
    >
      <text fg={theme.blue} attributes={TextAttributes.BOLD} wrapMode="none">
        Suite Command Center / {props.aggregates.totalFiles} files / {props.aggregates.totalTests} cases /{" "}
        {fmtDuration(props.aggregates.totalDurationMs)} total
      </text>

      {/* KPI strip */}
      <box flexDirection="row" gap={2}>
        <box flexDirection="column" border borderColor={theme.success} paddingLeft={1} paddingRight={1} width={18}>
          <text fg={theme.success} attributes={TextAttributes.BOLD} wrapMode="none">
            HEALTHY
          </text>
          <text fg={theme.text} attributes={TextAttributes.BOLD} wrapMode="none">
            {props.aggregates.passing}
          </text>
          <text fg={theme.textMuted} wrapMode="none">
            {props.aggregates.totalPassed} tests
          </text>
        </box>
        <box flexDirection="column" border borderColor={theme.error} paddingLeft={1} paddingRight={1} width={18}>
          <text fg={theme.error} attributes={TextAttributes.BOLD} wrapMode="none">
            FAILING
          </text>
          <text fg={theme.text} attributes={TextAttributes.BOLD} wrapMode="none">
            {props.aggregates.failing}
          </text>
          <text fg={theme.textMuted} wrapMode="none">
            {props.aggregates.totalFailed} tests
          </text>
        </box>
        <box flexDirection="column" border borderColor={theme.warning} paddingLeft={1} paddingRight={1} width={18}>
          <text fg={theme.warning} attributes={TextAttributes.BOLD} wrapMode="none">
            ACTIVE
          </text>
          <text fg={theme.text} attributes={TextAttributes.BOLD} wrapMode="none">
            {props.runningCount}
          </text>
          <text fg={theme.textMuted} wrapMode="none">
            queue: {props.queueLength}
          </text>
        </box>
        <box flexDirection="column" border borderColor={theme.border} paddingLeft={1} paddingRight={1} width={18}>
          <text fg={theme.textMuted} attributes={TextAttributes.BOLD} wrapMode="none">
            NOT RUN
          </text>
          <text fg={theme.text} attributes={TextAttributes.BOLD} wrapMode="none">
            {props.aggregates.notRun}
          </text>
          <text fg={theme.textMuted} wrapMode="none">
            {props.aggregates.skipped} skip · {props.aggregates.mixed} mix
          </text>
        </box>
        <box flexDirection="column" border borderColor={theme.cyan} paddingLeft={1} paddingRight={1} flexGrow={1}>
          <text fg={theme.cyan} attributes={TextAttributes.BOLD} wrapMode="none">
            CASE PASS RATE
          </text>
          <text fg={theme.text} attributes={TextAttributes.BOLD} wrapMode="none">
            {(props.aggregates.passRate * 100).toFixed(1)}%
          </text>
          <text fg={theme.success} wrapMode="none">
            {ratioBar(props.aggregates.passRate, 16)}
          </text>
        </box>
        <box flexDirection="column" border borderColor={theme.blueDim} paddingLeft={1} paddingRight={1} width={18}>
          <text fg={theme.blue} attributes={TextAttributes.BOLD} wrapMode="none">
            FILE HEALTH
          </text>
          <text fg={theme.text} attributes={TextAttributes.BOLD} wrapMode="none">
            {(filePassRate() * 100).toFixed(1)}%
          </text>
          <text fg={theme.blue} wrapMode="none">
            {ratioBar(filePassRate(), 12)}
          </text>
        </box>
      </box>

      <text fg={theme.textMuted} wrapMode="none">
        {" "}
      </text>

      {/* Groups summary */}
      <text fg={theme.blue} attributes={TextAttributes.BOLD} wrapMode="none">
        Groups / pass density / click to run
      </text>
      <For each={props.groups.slice(0, 6)}>
        {(g) => {
          const fg = g.failingFiles > 0 ? theme.error : g.passingFiles === g.totalFiles ? theme.success : theme.text
          return (
            <text fg={fg} wrapMode="none" onMouseUp={() => props.onRunGroup(g.name)}>
              {" "}
              {short(g.name, 12).padEnd(13)}
              {progressBar(g.passingFiles, g.totalFiles, 18)} {g.passingFiles}✓ {g.failingFiles}✗ {g.runningFiles}● /{" "}
              {g.totalFiles}
            </text>
          )
        }}
      </For>

      <text fg={theme.textMuted} wrapMode="none">
        {" "}
      </text>

      {/* Two-column area: Failing | Slowest */}
      <box flexDirection="row" gap={2} flexGrow={1}>
        <box flexDirection="column" flexGrow={1}>
          <text fg={theme.error} attributes={TextAttributes.BOLD} wrapMode="none">
            Attention Queue
          </text>
          <Show
            when={needsAttention().length > 0}
            fallback={<text fg={theme.success}>All executed files are healthy.</text>}
          >
            <For each={needsAttention()}>
              {(f) => (
                <text
                  fg={suiteExecColor(f.lastRun?.status ?? "notrun")}
                  wrapMode="none"
                  onMouseUp={() => props.onRunFile(f.filePath)}
                >
                  {suiteStatusIcon(f.lastRun?.status ?? "notrun")} {short(f.relativePath, 34).padEnd(34)}{" "}
                  {String(f.lastRun?.failed ?? 0).padStart(3)}f
                </text>
              )}
            </For>
          </Show>
        </box>

        <box flexDirection="column" flexGrow={1}>
          <text fg={theme.warning} attributes={TextAttributes.BOLD} wrapMode="none">
            Slowest Files
          </text>
          <Show when={slowest().length > 0} fallback={<text fg={theme.textMuted}>No timing data yet.</text>}>
            <For each={slowest()}>
              {(f) => (
                <text fg={theme.text} wrapMode="none" onMouseUp={() => props.onRunFile(f.filePath)}>
                  {short(f.relativePath, 34).padEnd(34)} {fmtDuration(f.lastRun!.durationMs).padStart(7)}
                </text>
              )}
            </For>
          </Show>
        </box>
      </box>

      <text fg={theme.textMuted} wrapMode="none">
        {" "}
      </text>

      {/* Recent runs */}
      <text fg={theme.cyan} attributes={TextAttributes.BOLD} wrapMode="none">
        Recent Executions
      </text>
      <Show
        when={recentRuns().length > 0}
        fallback={
          <text fg={theme.textMuted}>No runs yet. Press R to run the whole suite, or click a group above.</text>
        }
      >
        <For each={recentRuns()}>
          {(r) => {
            const icon = suiteStatusIcon(r.status as never)
            const fg = r.status === "fail" ? theme.error : r.status === "pass" ? theme.success : theme.textMuted
            return (
              <text fg={fg} wrapMode="none">
                {" "}
                {icon} {relativeTime(new Date(r.ts).toISOString()).padStart(4)} ago {short(r.rel, 38).padEnd(38)}{" "}
                {String(r.passed).padStart(3)}p {String(r.failed).padStart(3)}f {fmtDuration(r.dur).padStart(7)}
              </text>
            )
          }}
        </For>
      </Show>

      <Show when={trendByFile().length > 0}>
        <text fg={theme.textMuted} wrapMode="none">
          {" "}
        </text>
        <text fg={theme.purple} attributes={TextAttributes.BOLD} wrapMode="none">
          Duration Trend
        </text>
        <For each={trendByFile()}>
          {(t) => (
            <text fg={theme.text} wrapMode="none">
              {" "}
              {short(t.rel, 38).padEnd(38)} {t.spark}
            </text>
          )}
        </For>
      </Show>

      <text fg={theme.textMuted} wrapMode="none">
        {" "}
      </text>
      <text fg={theme.accent} attributes={TextAttributes.BOLD} wrapMode="none" onMouseUp={props.onRunAll}>
        [ R / Run All ({props.aggregates.totalFiles} files) ]
      </text>
    </scrollbox>
  )
}
