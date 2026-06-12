import { For } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { theme } from "../theme"
import { BENCH_KEYBINDINGS } from "../keymap"

interface HelpOverlayProps {
  width: number
  height: number
  onClose: () => void
}

const CATEGORY_LABELS: Record<string, string> = {
  navigation: "Navigation",
  views: "Views",
  actions: "Actions",
  data: "Data Management",
  focus: "Focus",
}

const CATEGORY_ORDER = ["navigation", "views", "actions", "data", "focus"]

export function HelpOverlay(props: HelpOverlayProps) {
  const grouped = () => {
    const map = new Map<string, typeof BENCH_KEYBINDINGS>()
    for (const binding of BENCH_KEYBINDINGS) {
      const cat = binding.category ?? "actions"
      const list = map.get(cat) ?? []
      list.push(binding)
      map.set(cat, list)
    }
    return map
  }

  const contentWidth = Math.min(72, props.width - 10)
  const contentHeight = Math.min(props.height - 4, 30)

  return (
    <box
      width={props.width}
      height={props.height}
      backgroundColor={theme.overlay}
      flexDirection="column"
      justifyContent="center"
      alignItems="center"
      onMouseUp={props.onClose}
    >
      <box
        border
        borderColor={theme.borderFocus}
        backgroundColor={theme.surface}
        paddingLeft={3}
        paddingRight={3}
        paddingTop={2}
        paddingBottom={2}
        flexDirection="column"
        width={contentWidth}
        maxHeight={contentHeight}
        onMouseUp={(event) => event.stopPropagation()}
      >
        <text fg={theme.blue} attributes={TextAttributes.BOLD} wrapMode="none">
          Nikcli Bench TUI \u2014 Keyboard Reference
        </text>
        <text fg={theme.textMuted} wrapMode="none">
          {" "}
        </text>
        <For each={CATEGORY_ORDER}>
          {(cat) => {
            const bindings = grouped().get(cat)
            if (!bindings) return null
            return (
              <>
                <text fg={theme.cyan} attributes={TextAttributes.BOLD} wrapMode="none">
                  {CATEGORY_LABELS[cat] ?? cat}
                </text>
                <For each={bindings}>
                  {(binding) => (
                    <text fg={theme.text} wrapMode="none">
                      {" "}
                      {binding.label.padEnd(18)}
                      {binding.description}
                    </text>
                  )}
                </For>
                <text fg={theme.textMuted} wrapMode="none">
                  {" "}
                </text>
              </>
            )
          }}
        </For>
        <text fg={theme.textMuted} wrapMode="none" onMouseUp={props.onClose}>
          Press q / esc / ? / space to close
        </text>
      </box>
    </box>
  )
}
