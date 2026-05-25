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
}

export function ViewTabs(props: ViewTabsProps) {
  if (props.compareMode) return null

  const modes: { key: ViewMode; label: string; keybind: string }[] = [
    { key: "compare", label: "Compare", keybind: "1" },
    { key: "leaderboard", label: "Leaderboard", keybind: "2" },
    { key: "detail", label: "Detail", keybind: "3" },
    { key: "files", label: "Files", keybind: "4" },
  ]

  const sortLabel = () => {
    const dir = props.sortAsc ? "\u2191" : "\u2193"
    return `${props.sortMode}${dir}`
  }

  return (
    <box paddingLeft={2} paddingRight={2} backgroundColor={theme.surface} flexDirection="row" height={1} gap={1}>
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
              {isActive ? "\u25cf" : "\u25cb"} {mode.keybind}.{mode.label}
            </text>
          )
        }}
      </For>
      <box flexGrow={1} />
      <text fg={theme.textMuted} wrapMode="none">
        sort:{sortLabel()} | {props.filteredCount}/{props.totalCount}
      </text>
    </box>
  )
}
