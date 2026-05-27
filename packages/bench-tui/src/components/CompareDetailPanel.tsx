import { TextAttributes } from "@opentui/core"
import { theme, deltaBar, severityColor, ratioBar } from "../theme"
import { fmt, fmtDelta, short } from "../types"
import type { CompareResult } from "../types"

interface CompareDetailPanelProps {
  result: CompareResult | undefined
}

export function CompareDetailPanel(props: CompareDetailPanelProps) {
  const r = () => props.result
  if (!r()) return null
  const ratio = () => (r()!.rightValue === 0 ? 0 : Math.min(2, r()!.leftValue / r()!.rightValue))
  const action = () => {
    if (r()!.severity === "critical") return "Block release / inspect before merge"
    if (r()!.severity === "regression") return "Review diff / rerun focused benchmark"
    if (r()!.severity === "improvement") return "Capture as positive signal"
    return "Within threshold"
  }
  return (
    <box flexDirection="column" gap={0}>
      <text fg={theme.purple} attributes={TextAttributes.BOLD} wrapMode="none">
        Compare Detail
      </text>
      <text fg={theme.textMuted} wrapMode="none" content={r()!.suite + " / " + r()!.module} />
      <text fg={theme.text} attributes={TextAttributes.BOLD} wrapMode="none">
        {short(r()!.scenario, 34)}
      </text>
      <text fg={theme.textMuted} wrapMode="none">
        {" "}
      </text>

      <text fg={severityColor(r()!.severity)} attributes={TextAttributes.BOLD} wrapMode="none">
        {r()!.severity.toUpperCase()} / {r()!.leftIsBetter ? "faster" : r()!.deltaPercent > 0 ? "slower" : "stable"}
      </text>
      <text fg={theme.textMuted} wrapMode="none">
        {action()}
      </text>
      <text fg={severityColor(r()!.severity)} wrapMode="none">
        {ratioBar(Math.min(1, ratio() / 2), 18)} ratio {fmt(ratio(), 2)}x
      </text>

      <text fg={theme.cyan} wrapMode="none" onMouseUp={() => {}}>
        current: {fmt(r()!.leftValue, 4)} {r()!.unit}
      </text>
      <text fg={theme.yellow} wrapMode="none">
        baseline: {fmt(r()!.rightValue, 4)} {r()!.unit}
      </text>
      <text fg={theme.text} wrapMode="none">
        delta: {r()!.delta >= 0 ? "+" : ""}
        {fmt(r()!.delta, 4)} {r()!.unit}
      </text>
      <text fg={severityColor(r()!.severity)} wrapMode="none" attributes={TextAttributes.BOLD}>
        {fmtDelta(r()!.deltaPercent)}
      </text>
      <text fg={theme.textMuted} wrapMode="none" content={deltaBar(r()!.deltaPercent, 12)} />
      <text fg={r()!.leftIsBetter ? theme.success : theme.error} wrapMode="none" onMouseUp={() => {}}>
        {r()!.leftIsBetter ? "↑ faster" : "↓ slower"} / severity:{r()!.severity}
      </text>
    </box>
  )
}
