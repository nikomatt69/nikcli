import { For, Show } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { theme } from "../theme"
import { valueTrendColor } from "../theme"
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

  return (
    <box flexDirection="column" flexGrow={1}
      onMouseScroll={(event) => {
        event.preventDefault()
        event.stopPropagation()
        props.onScrollRows(event.scroll?.direction === "up" ? -1 : 1)
      }}
    >
      <text fg={theme.textMuted} wrapMode="none">
        {" #  scenario             module       best    avg     std \u00b1   trend  confidence"}
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
          const line = `${rank}. ${scenario} ${mod} ${best} ${avg} \u00b1${std.padStart(5)}  ${icon}  ${confidence.padStart(4)}`
          return (
            <text
              fg={isSel ? theme.accent : valueTrendColor(test.trend)}
              attributes={isSel ? TextAttributes.BOLD : TextAttributes.NONE}
              wrapMode="none"
              onMouseOver={() => props.onSelectRow(realIdx)}
              onMouseUp={() => props.onSelectRow(realIdx)}
            >
              {isSel ? "\u25b8" : " "}{line}
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
