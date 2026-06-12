import { TextAttributes } from "@opentui/core"
import { theme } from "../theme"

interface FilterBarProps {
  filterText: string
  setFilterText: (t: string | ((prev: string) => string)) => void
  filteredCount: number
  totalCount: number
  onClose: () => void
  onClear: () => void
  placeholder?: string
}

export function FilterBar(props: FilterBarProps) {
  const cursor = props.filterText.length

  return (
    <box paddingLeft={2} paddingRight={2} backgroundColor={theme.surfaceHover} flexDirection="row" height={1}>
      <text fg={theme.cyan} attributes={TextAttributes.BOLD}>
        filter
      </text>
      <text fg={theme.textMuted}>:</text>
      <text
        fg={props.filterText ? theme.text : theme.textMuted}
        content={props.filterText ? props.filterText.slice(0, cursor) : (props.placeholder ?? "type to filter")}
      />
      <text fg={theme.accent} attributes={TextAttributes.BOLD} content={"\u258c"} />
      <text fg={theme.text} content={props.filterText.slice(cursor)} />
      <text
        fg={theme.textMuted}
        onMouseUp={props.onClear}
        content={" [" + props.filteredCount + "/" + props.totalCount + "]"}
      />
      <box flexGrow={1} />
      <text fg={theme.textMuted} onMouseUp={props.onClear} content={"\u2716 "} />
      <text fg={theme.textMuted} onMouseUp={props.onClose} content={"esc"} />
    </box>
  )
}
