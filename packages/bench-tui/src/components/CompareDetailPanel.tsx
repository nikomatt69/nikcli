import { TextAttributes } from "@opentui/core"
import { theme, deltaColor, deltaBar } from "../theme"
import { fmt, fmtDelta } from "../types"
import type { CompareResult } from "../types"

interface CompareDetailPanelProps {
  result: CompareResult | undefined
}

export function CompareDetailPanel(props: CompareDetailPanelProps) {
  const r = () => props.result
  if (!r()) return null
  return (
    <box flexDirection="column" gap={0}>
      <text fg={theme.purple} attributes={TextAttributes.BOLD} wrapMode="none">
        {"\u2194"} Compare
      </text>
      <text
        fg={theme.textMuted}
        wrapMode="none"
        content={r()!.suite + " / " + r()!.module}
      />
      <text fg={theme.text} attributes={TextAttributes.BOLD} wrapMode="none">{r()!.scenario}</text>
      <text fg={theme.textMuted} wrapMode="none"> </text>

      <text
        fg={theme.cyan}
        wrapMode="none"
        onMouseUp={() => {}}
      >
        current: {fmt(r()!.leftValue, 4)} {r()!.unit}
      </text>
      <text fg={theme.yellow} wrapMode="none">baseline: {fmt(r()!.rightValue, 4)} {r()!.unit}</text>
      <text fg={theme.text} wrapMode="none">
        delta: {r()!.delta >= 0 ? "+" : ""}{fmt(r()!.delta, 4)} {r()!.unit}
      </text>
      <text fg={deltaColor(r()!.deltaPercent)} wrapMode="none" attributes={TextAttributes.BOLD}>
        {fmtDelta(r()!.deltaPercent)}
      </text>
      <text fg={theme.textMuted} wrapMode="none" content={deltaBar(r()!.deltaPercent, 12)} />
      <text
        fg={r()!.leftIsBetter ? theme.success : theme.error}
        wrapMode="none"
        onMouseUp={() => {}}
      >
        {r()!.leftIsBetter ? "\u2191 faster" : "\u2193 slower"}
        <text fg={theme.textMuted}> severity:{r()!.severity}</text>
      </text>
    </box>
  )
}
