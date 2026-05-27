import { For, Show, createMemo } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { theme, deltaColor, deltaBar, severityColor } from "../theme"
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
  const summary = createMemo(() => {
    const critical = props.compareResults.filter((r) => r.severity === "critical").length
    const regressions = props.compareResults.filter((r) => r.severity === "regression").length
    const improvements = props.compareResults.filter((r) => r.severity === "improvement").length
    return { critical, regressions, improvements }
  })

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
      <text fg={theme.purple} attributes={TextAttributes.BOLD} wrapMode="none">
        Explicit Compare / {props.compareResults.length} common benchmarks
      </text>
      <text fg={theme.textMuted} wrapMode="none">
        {" # scenario            module       left-val  right-val delta%    impact      status"}
      </text>
      <Show when={summary().critical > 0 || summary().regressions > 0 || summary().improvements > 0}>
        <text fg={theme.error} wrapMode="none">
          ⚠ {summary().critical} critical, {summary().regressions} regressions, {summary().improvements} improvements
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
          const trend = result.leftIsBetter ? "↑" : "↓"
          const severity = result.severity === "critical" ? "!!" : result.severity === "regression" ? "!" : " "
          const line = ` ${severity} ${scenario} ${mod} ${lVal} ${rVal} ${delta} ${deltaBar(result.deltaPercent, 9)} ${trend} ${result.severity}`
          return (
            <text
              fg={
                isSel
                  ? theme.accent
                  : result.severity === "neutral"
                    ? deltaColor(result.deltaPercent)
                    : severityColor(result.severity)
              }
              attributes={isSel || result.severity === "critical" ? TextAttributes.BOLD : TextAttributes.NONE}
              wrapMode="none"
              onMouseOver={() => props.onSelectRow(realIdx)}
              onMouseUp={() => props.onSelectRow(realIdx)}
            >
              {isSel ? "\u25b8" : " "}
              {line}
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
