import { Show, For, createMemo, createSignal } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { theme } from "../theme"
import { valueTrendColor } from "../theme"
import { fmt, short, trendIcon } from "../types"
import { Sparkline } from "./Sparkline"
import type { TestIndex, LoadedRun } from "../types"

interface DetailViewProps {
  selected: TestIndex | undefined
  allRuns: LoadedRun[]
}

export function DetailView(props: DetailViewProps) {
  const [showStats, setShowStats] = createSignal(true)
  const [showHistory, setShowHistory] = createSignal(true)

  const test = () => props.selected

  const timeSeries = createMemo(() => {
    const t = test()
    if (!t) return []
    const runOrder = [...t.runValues.keys()].sort((a, b) => a.localeCompare(b))
    return runOrder.map((runId) => {
      const entry = t.runValues.get(runId)!
      const run = props.allRuns.find((r) => r.run.runId === runId)
      return { runId, date: run?.exportedAt ?? runId, value: entry.value, isBest: t.bestRun === runId }
    })
  })

  const sparklineValues = createMemo(() => timeSeries().map((d) => d.value))

  const cv = () => {
    const t = test()
    if (!t || t.count === 0) return "0"
    return ((t.stdDev / t.avgValue) * 100).toFixed(1)
  }

  return (
    <box flexDirection="column" flexGrow={1} paddingLeft={1}>
      <Show when={test()} fallback={<text fg={theme.textMuted}>Select a benchmark (j/k) to view details</text>}>
        <text fg={theme.blue} attributes={TextAttributes.BOLD} wrapMode="none">
          {test()!.suite} / {test()!.module}
        </text>
        <text fg={theme.cyan} wrapMode="none" attributes={TextAttributes.BOLD}>
          {test()!.scenario}
        </text>
        <text fg={theme.textMuted} wrapMode="none">
          {test()!.unit}
        </text>
        <text fg={theme.textMuted} wrapMode="none">
          {" "}
        </text>

        <text
          fg={theme.text}
          attributes={TextAttributes.BOLD}
          wrapMode="none"
          onMouseUp={() => setShowStats((v) => !v)}
        >
          {showStats() ? "\u25bc" : "\u25b6"} Statistics ({test()!.count} run{test()!.count !== 1 ? "s" : ""})
        </text>
        <Show when={showStats()}>
          <text fg={theme.success} wrapMode="none" onMouseUp={() => {}}>
            {"\u2605"} best: {fmt(test()!.bestValue, 4)} {test()!.unit}
          </text>
          <text fg={theme.yellow} wrapMode="none">
            {"\u2248"} avg: {fmt(test()!.avgValue, 4)} {test()!.unit}
          </text>
          <text fg={theme.warning} wrapMode="none">
            median: {fmt(test()!.medianValue, 4)} {test()!.unit}
          </text>
          <text fg={theme.error} wrapMode="none">
            {"\u25bc"} worst: {fmt(test()!.worstValue, 4)} {test()!.unit}
          </text>
          <text fg={theme.textMuted} wrapMode="none">
            P95: {fmt(test()!.p95Value, 4)} {test()!.unit}
          </text>
          <text fg={theme.textMuted} wrapMode="none">
            {"\u00b1"}stddev: {fmt(test()!.stdDev, 4)} ({cv()}%)
          </text>
          <text fg={valueTrendColor(test()!.trend)} wrapMode="none">
            trend: {trendIcon(test()!.trend)} {test()!.trend}
            {test()!.trendConfidence > 0 ? ` (${(test()!.trendConfidence * 100).toFixed(0)}%)` : ""}
          </text>

          <Show when={test()!.regressionWarnings.length > 0}>
            <text fg={theme.textMuted} wrapMode="none">
              {" "}
            </text>
            <For each={test()!.regressionWarnings}>
              {(warn) => (
                <text fg={theme.warning} wrapMode="none" attributes={TextAttributes.BOLD}>
                  {"\u26a0"} {warn}
                </text>
              )}
            </For>
          </Show>
        </Show>

        <text fg={theme.textMuted} wrapMode="none">
          {" "}
        </text>
        <text
          fg={theme.blue}
          attributes={TextAttributes.BOLD}
          wrapMode="none"
          onMouseUp={() => setShowHistory((v) => !v)}
        >
          {showHistory() ? "\u25bc" : "\u25b6"} History ({timeSeries().length} run{timeSeries().length !== 1 ? "s" : ""}
          )
        </text>
        <Show when={showHistory() && sparklineValues().length >= 2}>
          <Sparkline values={sparklineValues()} fg={theme.cyan} width={Math.min(sparklineValues().length, 30)} />
        </Show>
        <Show when={showHistory()}>
          <For each={timeSeries().slice(-12)}>
            {(point) => {
              const diff = point.value - (test()?.avgValue ?? 0)
              const arrow = diff < -0.01 ? "\u2193" : diff > 0.01 ? "\u2191" : "\u2192"
              return (
                <text fg={point.isBest ? theme.success : theme.textMuted} wrapMode="none" onMouseUp={() => {}}>
                  {point.isBest ? "\u2605 " : "   "}
                  {short(point.runId.slice(0, 18), 18).padEnd(18)} {fmt(point.value, 4).padStart(10)} {test()!.unit}{" "}
                  {arrow}
                </text>
              )
            }}
          </For>
        </Show>
      </Show>
    </box>
  )
}
