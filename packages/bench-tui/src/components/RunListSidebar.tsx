import { For, Show } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { theme } from "../theme"
import { fmt, short, relativeTime } from "../types"
import type { LoadedRun } from "../types"

interface RunListSidebarProps {
  runs: LoadedRun[]
  runIdx: number
  runScrollOff: number
  pageSize: number
  onSelectRun: (index: number) => void
  onFocus: () => void
  onScrollRuns: (direction: 1 | -1) => void
  baselineRunId: string | null
  focused: boolean
  compact?: boolean
  loading: boolean
}

export function RunListSidebar(props: RunListSidebarProps) {
  const visibleRuns = () => props.runs.slice(props.runScrollOff, props.runScrollOff + props.pageSize)
  const width = props.compact ? 16 : 22

  return (
    <box
      width={width}
      border
      borderColor={props.focused ? theme.borderFocus : theme.border}
      backgroundColor={theme.surface}
      paddingLeft={1} paddingRight={1}
      flexDirection="column"
      onMouseOver={props.onFocus}
      onMouseScroll={(event) => {
        event.preventDefault()
        event.stopPropagation()
        props.onScrollRuns(event.scroll?.direction === "up" ? -1 : 1)
      }}
    >
      <text
        fg={props.focused ? theme.accent : theme.blue}
        attributes={TextAttributes.BOLD}
        wrapMode="none"
      >
        Runs {props.runs.length > 0 ? `(${props.runIdx + 1}/${props.runs.length})` : ""}
      </text>
      <Show
        when={!props.loading && props.runs.length > 0}
        fallback={
          <text fg={theme.textMuted}>
            {props.loading ? "Loading..." : "No runs yet"}
          </text>
        }
      >
        <For each={visibleRuns()}>
          {(run, i) => {
            const realIdx = props.runScrollOff + i()
            const isActive = realIdx === props.runIdx
            const isBaseline = props.baselineRunId === run.filePath || props.baselineRunId === run.run.runId
            const recCount = run.run.records.length
            const age = relativeTime(run.exportedAt)

            if (props.compact) {
              return (
                <text
                  fg={isActive ? theme.accent : isBaseline ? theme.cyan : theme.text}
                  wrapMode="none"
                  attributes={isActive || isBaseline ? TextAttributes.BOLD : TextAttributes.NONE}
                  onMouseOver={() => props.onSelectRun(realIdx)}
                  onMouseUp={() => props.onSelectRun(realIdx)}
                >
                  {isActive ? "\u25b8" : " "}{isBaseline ? "\u2605" : " "}
                  {String(realIdx + 1).padStart(2)}.{short(run.run.runId, width - 8)}
                </text>
              )
            }
            return (
              <box
                flexDirection="column"
                gap={0}
                onMouseOver={() => props.onSelectRun(realIdx)}
                onMouseUp={() => props.onSelectRun(realIdx)}
              >
                <text
                  fg={isActive ? theme.accent : isBaseline ? theme.cyan : theme.text}
                  wrapMode="none"
                  attributes={isActive || isBaseline ? TextAttributes.BOLD : TextAttributes.NONE}
                >
                  {isActive ? "\u25b8" : " "}{isBaseline ? "\u2605" : " "}
                  {String(realIdx + 1).padStart(2)}.{short(run.run.runId, width - 8)}
                </text>
                <text
                  fg={isActive ? theme.accent : theme.textMuted}
                  wrapMode="none"
                  attributes={isActive ? TextAttributes.BOLD : TextAttributes.NONE}
                >
                  {"    "}{String(recCount).padStart(3)} rec {age}
                </text>
              </box>
            )
          }}
        </For>
      </Show>
    </box>
  )
}
