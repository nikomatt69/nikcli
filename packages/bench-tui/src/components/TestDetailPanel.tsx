import { For, Show, createSignal } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { theme } from "../theme"
import { valueTrendColor } from "../theme"
import { fmt, short, trendIcon } from "../types"
import type { TestIndex } from "../types"

interface TestDetailPanelProps {
  test: TestIndex | undefined
}

export function TestDetailPanel(props: TestDetailPanelProps) {
  const [showAll, setShowAll] = createSignal(false)
  const [showRuns, setShowRuns] = createSignal(true)

  const test = () => props.test
  if (!test()) return null

  const cv = () => {
    if (test()!.count === 0) return "0"
    return ((test()!.stdDev / test()!.avgValue) * 100).toFixed(1)
  }

  return (
    <box flexDirection="column" gap={0}>
      <text fg={theme.blue} attributes={TextAttributes.BOLD} wrapMode="none">
        {test()!.suite}
      </text>
      <text fg={theme.cyan} wrapMode="none" attributes={TextAttributes.BOLD}>
        {test()!.module}
      </text>
      <text fg={theme.text} wrapMode="none">
        {test()!.scenario}
      </text>
      <text fg={theme.textMuted} wrapMode="none">
        {test()!.unit}
      </text>
      <text fg={theme.textMuted} wrapMode="none">
        {" "}
      </text>

      <text fg={theme.text} attributes={TextAttributes.BOLD} wrapMode="none" onMouseUp={() => setShowAll((v) => !v)}>
        {showAll() ? "\u25bc" : "\u25b6"} Stats
      </text>
      <Show when={showAll()}>
        <text fg={theme.success} wrapMode="none">
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
        <text fg={theme.textMuted} wrapMode="none">
          runs: {test()!.count}
        </text>
      </Show>

      <Show when={!showAll()}>
        <text fg={theme.success} wrapMode="none">
          {"\u2605"} {fmt(test()!.bestValue, 4)} {"\u2248"}
          {fmt(test()!.avgValue, 4)} {"\u25bc"}
          {fmt(test()!.worstValue, 4)}
        </text>
        <text fg={valueTrendColor(test()!.trend)} wrapMode="none">
          {trendIcon(test()!.trend)} {test()!.trend} | \u00b1{cv()}%
        </text>
      </Show>

      <text fg={theme.textMuted} wrapMode="none">
        {" "}
      </text>
      <text fg={theme.blue} attributes={TextAttributes.BOLD} wrapMode="none" onMouseUp={() => setShowRuns((v) => !v)}>
        {showRuns() ? "\u25bc" : "\u25b6"} Runs ({test()!.runs.length})
      </text>
      <Show when={showRuns()}>
        <For each={test()!.runs.slice(0, showAll() ? undefined : 6)}>
          {(runId) => {
            const entry = test()!.runValues.get(runId)
            const isBest = test()!.bestRun === runId
            const isLatest = test()!.runs[test()!.runs.length - 1] === runId
            return (
              <text
                fg={isBest ? theme.success : isLatest ? theme.yellow : theme.textMuted}
                wrapMode="none"
                attributes={isBest ? TextAttributes.BOLD : TextAttributes.NONE}
                onMouseUp={() => {}}
              >
                {isBest ? "\u2605 " : "   "}
                {short(runId.slice(0, 14), 14).padEnd(14)} {fmt(entry?.value ?? 0, 3).padStart(8)}
                {isLatest ? " \u2190" : ""}
              </text>
            )
          }}
        </For>
        <Show when={!showAll() && test()!.runs.length > 6}>
          <text fg={theme.textMuted} wrapMode="none" onMouseUp={() => setShowAll(true)}>
            ... {test()!.runs.length - 6} more
          </text>
        </Show>
      </Show>
    </box>
  )
}
