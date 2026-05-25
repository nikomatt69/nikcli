import { For, Show } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { theme, deltaColor } from "../theme"
import { fmt, short, fmtDelta } from "../types"
import type { CompareResult } from "../types"

interface CompareModeViewProps {
  compareResults: CompareResult[]
  scrollOff: number
  pageHeight: number
  rowIdx: number
  onSelectRow: (index: number) => void
  onScrollRows: (direction: 1 | -1) => void
}

export function CompareModeView(props: CompareModeViewProps) {
  const rows = () => props.compareResults.slice(props.scrollOff, props.scrollOff + props.pageHeight)
  const criticalCount = () => props.compareResults.filter((r) => r.severity === "critical").length
  const regressionCount = () => props.compareResults.filter((r) => r.severity === "regression").length

  return (
    <box flexDirection="column" flexGrow={1}
      onMouseScroll={(event) => {
        event.preventDefault()
        event.stopPropagation()
        props.onScrollRows(event.scroll?.direction === "up" ? -1 : 1)
      }}
    >
      <text fg={theme.textMuted} wrapMode="none">
        {" # scenario            module       left-val  right-val delta%    impact"}
      </text>
      <Show when={criticalCount() > 0 || regressionCount() > 0}>
        <text fg={theme.error} wrapMode="none">
          {"\u26a0"} {criticalCount()} critical, {regressionCount()} regressions
        </text>
      </Show>
      <For each={rows()}>
        {(result, i) => {
          const realIdx = props.scrollOff + i()
          const isSel = realIdx === props.rowIdx
          const scenario = short(result.scenario, 18).padEnd(18)
          const mod = short(result.module, 12).padEnd(12)
          const lVal = fmt(result.leftValue, 1).padStart(8)
          const rVal = fmt(result.rightValue, 1).padStart(8)
          const delta = fmtDelta(result.deltaPercent).padStart(7)
          const trend = result.leftIsBetter ? "\u2191" : "\u2193"
          const severity = result.severity === "critical" ? "!!" : result.severity === "regression" ? "!" : " "
          const line = ` ${severity} ${scenario} ${mod} ${lVal} ${rVal} ${delta} ${trend}`
          return (
            <text
              fg={isSel ? theme.accent : deltaColor(result.deltaPercent)}
              attributes={isSel || result.severity === "critical" ? TextAttributes.BOLD : TextAttributes.NONE}
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
        <text fg={theme.textMuted}>No common benchmarks between the two runs.</text>
      </Show>
    </box>
  )
}
