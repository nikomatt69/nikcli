import { For, Show, createSignal } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { theme } from "../theme"
import { short } from "../types"

interface LogPanelProps {
  logLines: string[]
  terminalWidth: number
  focused: boolean
  onFocus: () => void
}

export function LogPanel(props: LogPanelProps) {
  const [scrollOffset, setScrollOffset] = createSignal(0)
  const maxVisible = 5

  const totalLines = () => props.logLines.length

  const visibleLines = () => {
    const end = totalLines() - scrollOffset()
    const start = Math.max(0, end - maxVisible)
    return props.logLines.slice(start, end)
  }

  const atBottom = () => scrollOffset() === 0

  const handleScroll = (dir: "up" | "down") => {
    const maxScroll = Math.max(0, totalLines() - maxVisible)
    if (dir === "up") {
      setScrollOffset((o) => Math.min(maxScroll, o + 1))
    } else {
      setScrollOffset((o) => Math.max(0, o - 1))
    }
  }

  return (
    <box
      paddingLeft={2} paddingRight={2}
      border={["top"]}
      borderColor={props.focused ? theme.borderFocus : theme.border}
      backgroundColor={theme.surfaceHover}
      flexDirection="column"
      maxHeight={maxVisible + 2}
      onMouseOver={() => { props.onFocus(); setScrollOffset(0) }}
      onMouseScroll={(event) => {
        event.preventDefault()
        event.stopPropagation()
        handleScroll(event.scroll?.direction === "up" ? "up" : "down")
      }}
    >
      <Show
        when={totalLines() > 0}
        fallback={<text fg={theme.textMuted} wrapMode="none">No output yet. Press r to run the target package tests.</text>}
      >
        <Show when={!atBottom()}>
          <text
            fg={theme.textMuted}
            wrapMode="none"
            attributes={TextAttributes.BOLD}
            onMouseUp={() => setScrollOffset(0)}
          >
            {"\u2191"} {scrollOffset()} lines above (scroll back)
          </text>
        </Show>
        <For each={visibleLines()}>
          {(line) => {
            const isError = line.includes("\u2717") || /error|fail|exit: [1-9]/i.test(line)
            const isSuccess = line.includes("\u2713") || /done|ok|success/i.test(line)
            const isRunning = line.includes("\u25b6") || line.includes("RUNNING")
            return (
              <text
                fg={
                  isError ? theme.error
                    : isSuccess ? theme.success
                      : isRunning ? theme.warning
                        : theme.textMuted
                }
                attributes={isError ? TextAttributes.BOLD : TextAttributes.NONE}
                wrapMode="none"
                onMouseUp={() => {}}
              >
                {short(line, Math.max(80, props.terminalWidth - 4))}
              </text>
            )
          }}
        </For>
      </Show>
    </box>
  )
}
