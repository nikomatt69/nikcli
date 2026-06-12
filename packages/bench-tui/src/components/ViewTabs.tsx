import { For } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { theme } from "../theme"
import type { ViewMode, SortMode } from "../types"

interface ViewTabsProps {
  viewMode: ViewMode
  setViewMode: (m: ViewMode) => void
  compareMode: boolean
  sortMode: SortMode
  sortAsc: boolean
  filteredCount: number
  totalCount: number
  showOnlyFailures?: boolean
  onToggleOnlyFailures?: () => void
  runningCount?: number
}

export function ViewTabs(props: ViewTabsProps) {
  if (props.compareMode) return null

  const modes: { key: ViewMode; label: string; keybind: string }[] = [
    { key: "suite", label: "Tests", keybind: "1" },
    { key: "compare", label: "Bench Compare", keybind: "2" },
    { key: "leaderboard", label: "Benchmarks", keybind: "3" },
    { key: "detail", label: "Bench Detail", keybind: "4" },
    { key: "files", label: "Files", keybind: "5" },
  ]

  const sortLabel = () => {
    const dir = props.sortAsc ? "\u2191" : "\u2193"
    return `${props.sortMode}${dir}`
  }

  return (
    <box paddingLeft={2} paddingRight={2} backgroundColor={theme.surface} flexDirection="row" height={1} gap={1}>
      <text fg={theme.textMuted} wrapMode="none">
        views tab/shift-tab
      </text>
      <For each={modes}>
        {(mode) => {
          const isActive = props.viewMode === mode.key
          return (
            <text
              fg={isActive ? theme.accent : theme.textMuted}
              attributes={isActive ? TextAttributes.BOLD : TextAttributes.NONE}
              wrapMode="none"
              onMouseUp={() => props.setViewMode(mode.key)}
            >
              {isActive ? "●" : "·"} {mode.keybind}.{mode.label}
            </text>
          )
        }}
      </For>
      <box flexGrow={1} />
      {props.runningCount !== undefined && props.runningCount > 0 && (
        <text fg={theme.warning} attributes={TextAttributes.BOLD} wrapMode="none">
          ● {props.runningCount} running
        </text>
      )}
      {props.showOnlyFailures && (
        <text
          fg={theme.error}
          attributes={TextAttributes.BOLD}
          wrapMode="none"
          onMouseUp={() => props.onToggleOnlyFailures?.()}
        >
          [failures only]
        </text>
      )}
      <text fg={theme.textMuted} wrapMode="none">
        sort:{sortLabel()} rows:{props.filteredCount}/{props.totalCount}
      </text>
    </box>
  )
}
