import { For, Show, createMemo } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { theme } from "../theme"
import { valueTrendColor, ratioBar } from "../theme"
import { fmt, short, trendIcon } from "../types"
import type { TestIndex } from "../types"

interface LeaderboardViewProps {
  leaderboardRows: () => TestIndex[]
  scrollOff: number
  pageHeight: number
  rowIdx: number
  onSelectRow: (index: number) => void
  onScrollRows: (direction: 1 | -1) => void
}

export function LeaderboardView(props: LeaderboardViewProps) {
  const rows = () => props.leaderboardRows().slice(props.scrollOff, props.scrollOff + props.pageHeight)
  const summary = createMemo(() => {
    const all = props.leaderboardRows()
    const improving = all.filter((t) => t.trend === "up").length
    const degrading = all.filter((t) => t.trend === "down").length
    const stable = all.filter((t) => t.trend === "stable").length
    const noisy = all.filter((t) => t.avgValue > 0 && t.stdDev / t.avgValue > 0.15).length
    return { total: all.length, improving, degrading, stable, noisy }
  })
  const stability = () => (summary().total > 0 ? summary().stable / summary().total : 0)

  return (
    <box
      flexDirection="column"
      flexGrow={1}
      onMouseScroll={(event) => {
        event.preventDefault()
        event.stopPropagation()
        props.onScrollRows(event.scroll?.direction === "up" ? -1 : 1)
      }}
    >
      <text fg={theme.blue} attributes={TextAttributes.BOLD} wrapMode="none">
        Leaderboard / {summary().total} benchmarks / stable {ratioBar(stability(), 12)}
      </text>
      <text fg={summary().degrading > 0 ? theme.warning : theme.success} wrapMode="none">
        {summary().improving} improving {summary().degrading} degrading {summary().stable} stable {summary().noisy}{" "}
        noisy
      </text>
      <text fg={theme.textMuted} wrapMode="none">
        {" #  scenario             module       best    avg     std \u00b1   trend  confidence  runs"}
      </text>
      <For each={rows()}>
        {(test, i) => {
          const realIdx = props.scrollOff + i()
          const isSel = realIdx === props.rowIdx
          const scenario = short(test.scenario, 20).padEnd(20)
          const mod = short(test.module, 12).padEnd(12)
          const best = fmt(test.bestValue, 1).padStart(6)
          const avg = fmt(test.avgValue, 1).padStart(6)
          const std = test.stdDev > 0 ? fmt(test.stdDev, 1) : "-"
          const rank = String(realIdx + 1).padStart(2)
          const icon = trendIcon(test.trend)
          const confidence = test.trendConfidence > 0 ? `${(test.trendConfidence * 100).toFixed(0)}%` : "-"
          const line = `${rank}. ${scenario} ${mod} ${best} ${avg} ±${std.padStart(5)}  ${icon}  ${confidence.padStart(4)}  ${String(test.count).padStart(3)}`
          return (
            <text
              fg={isSel ? theme.accent : valueTrendColor(test.trend)}
              attributes={isSel ? TextAttributes.BOLD : TextAttributes.NONE}
              wrapMode="none"
              onMouseOver={() => props.onSelectRow(realIdx)}
              onMouseUp={() => props.onSelectRow(realIdx)}
            >
              {isSel ? "▸" : " "}
              {line}
            </text>
          )
        }}
      </For>
      <Show when={rows().length === 0}>
        <text fg={theme.textMuted}>No benchmark data available.</text>
      </Show>
    </box>
  )
}
