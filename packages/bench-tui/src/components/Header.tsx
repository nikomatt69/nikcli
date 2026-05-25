import { TextAttributes } from "@opentui/core"
import { theme, stateColor, stateIcon } from "../theme"
import { short, fmt, relativeTime } from "../types"
import type { FocusPane, LoadedRun, RunnerState, ViewMode } from "../types"

interface HeaderProps {
  state: RunnerState
  terminalWidth: number
  runDuration: () => number | null
  activeRun: LoadedRun | undefined
  runs: LoadedRun[]
  allTests: () => any[]
  activeRunDelta: () => number | null
  baselineRunId: string | null
  focusPane: FocusPane
  loading: boolean
  hasAlerts: () => boolean
  onRun: () => void
  onRefresh: () => void
  onCycleView: () => void
  viewMode: ViewMode
}

export function Header(props: HeaderProps) {
  const statusText = () =>
    props.state === "running"
      ? `RUNNING${props.runDuration() ? ` ${fmt(props.runDuration() / 1000, 1)}s` : ""}`
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
      parts.push(`${props.runs.length} run${props.runs.length !== 1 ? "s" : ""}`)
      parts.push(`${props.allTests().length} benchmark${props.allTests().length !== 1 ? "s" : ""}`)
      if (props.activeRun) {
        parts.push(short(props.activeRun.run.runId, 20))
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
    compare: "Compare",
    leaderboard: "Leaderboard",
    detail: "Detail",
    files: "Files",
  }

  return (
    <box height={4} width="100%" backgroundColor={theme.bg} flexDirection="column">
      <box height={1} paddingLeft={2} paddingRight={2} flexDirection="row">
        <text fg={theme.text} attributes={TextAttributes.BOLD} content={"\u26a1 Bench TUI"} />
        <text fg={theme.textMuted} content={" \u00b7 "} />
        <text
          fg={theme.blue}
          attributes={TextAttributes.BOLD}
          onMouseUp={() => props.onCycleView()}
          content={viewNames[props.viewMode]}
        />
        <box flexGrow={1} />
        <text fg={theme.textMuted} content={"view:"} />
        <text
          fg={props.focusPane === "main" ? theme.accent : theme.textMuted}
          attributes={TextAttributes.BOLD}
          content={props.focusPane}
        />
        {props.hasAlerts() && (
          <text fg={theme.warning} attributes={TextAttributes.BOLD} content={" \u26a0"} />
        )}
        <text
          fg={stateColor(props.state)}
          attributes={props.state === "running" ? TextAttributes.BOLD : TextAttributes.NONE}
          onMouseUp={() => { if (props.state !== "running") props.onRun() }}
          content={" " + status()}
        />
      </box>
      <box height={1} paddingLeft={2} paddingRight={2} flexDirection="row">
        <text
          fg={theme.textMuted}
          wrapMode="none"
          onMouseUp={() => props.onRefresh()}
          content={summary()}
        />
        <box flexGrow={1} />
        <text
          fg={theme.textMuted}
          wrapMode="none"
          onMouseUp={() => props.onCycleView()}
          content={`[${props.viewMode}]`}
        />
      </box>
      <box height={1} paddingLeft={2} paddingRight={2}>
        <text fg={theme.textMuted} wrapMode="none" content={
          "r=run u=refresh h/l=runs j/k=scroll tab=view 1-4 ?=help q=quit"
        } />
        {props.state === "running" && (
          <text fg={theme.warning} wrapMode="none" content={" \u25cf running..."} />
        )}
      </box>
      <box height={1} backgroundColor={theme.border} />
    </box>
  )
}
