import { For, Show } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { theme, deltaColor, deltaBar } from "../theme"
import { fmt, short, fmtDelta } from "../types"
import type { CompareResult } from "../types"

interface CompareViewProps {
  dashboardRows: () => CompareResult[]
  hasBaseline: boolean
  scrollOff: number
  pageHeight: number
  rowIdx: number
  onSelectRow: (index: number) => void
  onScrollRows: (direction: 1 | -1) => void
}

export function CompareView(props: CompareViewProps) {
  const rows = () => props.dashboardRows().slice(props.scrollOff, props.scrollOff + props.pageHeight)

  return (
    <box flexDirection="column" flexGrow={1}
      onMouseScroll={(event) => {
        event.preventDefault()
        event.stopPropagation()
        props.onScrollRows(event.scroll?.direction === "up" ? -1 : 1)
      }}
    >
      <text fg={theme.textMuted} wrapMode="none">
        {" # scenario               module         current   baseline  delta%     impact     "}
      </text>
      <For each={rows()}>
        {(row, i) => {
          const realIdx = props.scrollOff + i()
          const isSel = realIdx === props.rowIdx
          const scenario = short(row.scenario, 22).padEnd(22)
          const mod = short(row.module, 14).padEnd(14)
          const current = fmt(row.leftValue, 2).padStart(8)
          const baseline = fmt(row.rightValue, 2).padStart(8)
          const delta = fmtDelta(row.deltaPercent).padStart(8)
          const bar = deltaBar(row.deltaPercent, 10)
          const severity = row.severity === "critical" ? "!" : row.severity === "regression" ? "\u2193" : " "
          const col = deltaColor(row.deltaPercent)
          return (
            <text
              fg={isSel ? theme.accent : col}
              attributes={isSel || row.severity === "critical" ? TextAttributes.BOLD : TextAttributes.NONE}
              wrapMode="none"
              onMouseOver={() => props.onSelectRow(realIdx)}
              onMouseUp={() => props.onSelectRow(realIdx)}
            >
              {isSel ? "\u25b8" : " "}{severity} {scenario} {mod} {current} {baseline} {delta} {bar}
            </text>
          )
        }}
      </For>
      <Show when={rows().length === 0}>
        <text fg={theme.textMuted}>
          {props.hasBaseline
            ? "No comparable benchmark rows."
            : "Need two benchmark runs to compare. Press r to run."}
        </text>
      </Show>
    </box>
  )
}
