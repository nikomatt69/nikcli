import { For, Show, createMemo } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { theme, deltaBar, severityColor, ratioBar } from "../theme"
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
  const summary = createMemo(() => {
    const all = props.dashboardRows()
    const regressions = all.filter((r) => r.severity === "regression" || r.severity === "critical").length
    const improvements = all.filter((r) => r.severity === "improvement").length
    const critical = all.filter((r) => r.severity === "critical").length
    const stable = all.filter((r) => r.severity === "neutral").length
    const worst = all.find((r) => r.severity === "critical" || r.severity === "regression")
    return { total: all.length, regressions, improvements, critical, stable, worst }
  })
  const health = () => (props.dashboardRows().length === 0 ? 0 : summary().stable / props.dashboardRows().length)

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
        Compare Dashboard / {summary().total} matched benchmarks / stability {ratioBar(health(), 12)}
      </text>
      <text
        fg={summary().critical > 0 ? theme.error : summary().regressions > 0 ? theme.warning : theme.success}
        wrapMode="none"
      >
        {summary().critical} critical {summary().regressions} slower {summary().improvements} faster {summary().stable}{" "}
        stable
        {summary().worst
          ? `  worst ${short(summary().worst!.scenario, 18)} ${fmtDelta(summary().worst!.deltaPercent)}`
          : ""}
      </text>
      <text fg={theme.textMuted} wrapMode="none">
        {" # scenario               module         current   baseline  delta%     impact      status"}
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
          const severity =
            row.severity === "critical"
              ? "!"
              : row.severity === "regression"
                ? "↓"
                : row.severity === "improvement"
                  ? "↑"
                  : " "
          const status = row.severity.padEnd(11)
          return (
            <text
              fg={isSel ? theme.accent : row.severity === "neutral" ? theme.textMuted : severityColor(row.severity)}
              attributes={isSel || row.severity === "critical" ? TextAttributes.BOLD : TextAttributes.NONE}
              wrapMode="none"
              onMouseOver={() => props.onSelectRow(realIdx)}
              onMouseUp={() => props.onSelectRow(realIdx)}
            >
              {isSel ? "▸" : " "}
              {severity} {scenario} {mod} {current} {baseline} {delta} {bar} {status}
            </text>
          )
        }}
      </For>
      <Show when={rows().length === 0}>
        <text fg={theme.textMuted}>
          {props.hasBaseline ? "No comparable benchmark rows." : "Need two benchmark runs to compare. Press r to run."}
        </text>
      </Show>
    </box>
  )
}
