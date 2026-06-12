import { TextAttributes } from "@opentui/core"
import { theme, stateColor, stateIcon, truncateMiddle } from "../theme"
import { short, fmtDuration, relativeTime } from "../types"
import type { FocusPane, LoadedRun, RunnerState, ViewMode } from "../types"

interface HeaderProps {
  state: RunnerState
  terminalWidth: number
  runDuration: () => number | null
  activeRun: LoadedRun | undefined
  runs: LoadedRun[]
  testFileCount: number
  testCaseCount: number
  targetPackageName: string
  activeRunDelta: () => number | null
  baselineRunId: string | null
  focusPane: FocusPane
  loading: boolean
  hasAlerts: () => boolean
  onRun: () => void
  onRefresh: () => void
  onCycleView: () => void
  viewMode: ViewMode
  platform: string
}

export function Header(props: HeaderProps) {
  const statusText = () =>
    props.state === "running"
      ? `RUNNING${props.runDuration() ? ` ${fmtDuration(props.runDuration()!)}` : ""}`
      : props.state === "success"
        ? "OK"
        : props.state === "error"
          ? "ERR"
          : "idle"

  const status = () => `${stateIcon(props.state)} ${statusText()}`

  const summary = () => {
    const parts: string[] = []
    if (props.loading) {
      parts.push("Loading...")
    } else {
      parts.push(props.targetPackageName)
      parts.push(`${props.testFileCount} test file${props.testFileCount !== 1 ? "s" : ""}`)
      parts.push(`${props.testCaseCount} indexed case${props.testCaseCount !== 1 ? "s" : ""}`)
      parts.push(`${props.runs.length} benchmark run${props.runs.length !== 1 ? "s" : ""}`)
      parts.push(props.platform)
      if (props.activeRun) {
        parts.push(truncateMiddle(props.activeRun.run.runId, 18))
        parts.push(relativeTime(props.activeRun.exportedAt))
      }
      const delta = props.activeRunDelta()
      if (delta !== null) {
        const prefix = delta >= 0 ? "+" : ""
        parts.push(`${prefix}${delta.toFixed(1)}% vs baseline`)
      }
      if (props.baselineRunId) parts.push("\u2605 baseline")
    }
    return short(parts.join(" | "), Math.max(40, props.terminalWidth * 0.6))
  }

  const viewNames: Record<ViewMode, string> = {
    suite: "Tests",
    compare: "Compare",
    leaderboard: "Leaderboard",
    detail: "Detail",
    files: "Files",
  }

  return (
    <box height={4} width="100%" backgroundColor={theme.bg} flexDirection="column">
      <box height={1} paddingLeft={2} paddingRight={2} flexDirection="row">
        <text fg={theme.accent} attributes={TextAttributes.BOLD} content={"Nikcli Test Interface"} />
        <text fg={theme.textMuted} content={" / "} />
        <text
          fg={theme.blue}
          attributes={TextAttributes.BOLD}
          onMouseUp={() => props.onCycleView()}
          content={viewNames[props.viewMode]}
        />
        <box flexGrow={1} />
        <text fg={theme.textMuted} content={"focus:"} />
        <text fg={theme.accent} attributes={TextAttributes.BOLD} content={props.focusPane} />
        {props.hasAlerts() && <text fg={theme.warning} attributes={TextAttributes.BOLD} content={" ⚠"} />}
        <text
          fg={stateColor(props.state)}
          attributes={props.state === "running" ? TextAttributes.BOLD : TextAttributes.NONE}
          onMouseUp={() => {
            if (props.state !== "running") props.onRun()
          }}
          content={"  " + status()}
        />
      </box>
      <box height={1} paddingLeft={2} paddingRight={2} flexDirection="row">
        <text fg={theme.textMuted} wrapMode="none" onMouseUp={() => props.onRefresh()} content={summary()} />
        <box flexGrow={1} />
        <text
          fg={theme.textMuted}
          wrapMode="none"
          onMouseUp={() => props.onCycleView()}
          content={`mode:${props.viewMode}`}
        />
      </box>
      <box height={1} paddingLeft={2} paddingRight={2}>
        <text
          fg={theme.textMuted}
          wrapMode="none"
          content={
            "r=run tests  B=benchmarks  ↵=selected  Space=toggle  Ctrl+P=palette  /=filter  Tab=view  ?=help"
          }
        />
        {props.state === "running" && <text fg={theme.warning} wrapMode="none" content={"  ● live"} />}
      </box>
      <box height={1} backgroundColor={theme.border} />
    </box>
  )
}
