import { TextAttributes } from "@opentui/core"
import { useTheme } from "@tui/context/theme"
import { useDialog } from "@tui/ui/dialog"
import { useKeybind } from "@tui/context/keybind"
import { useKeyboard } from "@opentui/solid"
import { createSignal, For, Show } from "solid-js"

interface Step {
  title: string
  body: string
  hint?: string
}

const STEPS: Step[] = [
  {
    title: "Welcome to nikcli",
    body: "You're in the TUI — a focused, keyboard-first place to talk to AI about your project. This 6-step tour shows you around in under a minute. Press → to advance, ← to go back, esc to exit.",
  },
  {
    title: "The prompt",
    body: "The big box at the bottom is where you type. Press Enter to send. Use ↑ / ↓ to scroll through your prompt history. Start a new line with Shift+Enter.",
  },
  {
    title: "Command palette",
    body: "Every action in nikcli lives behind the command palette. Press the shortcut below to open it — search for anything (models, agents, sessions, themes, settings).",
  },
  {
    title: "Slash commands",
    body: "Type a / in the prompt to autocomplete slash commands: /sessions, /models, /agents, /themes, /status, /usage, /auth, /help. They cover the same surface as the palette, just faster for muscle memory.",
  },
  {
    title: "Sessions & history",
    body: "The sidebar (or /sessions) lists every conversation you've had. Pick one to jump back in. Pin your favorites with the pin action — they appear in quickSwitch slots 1-9.",
  },
  {
    title: "Help & docs",
    body: "Press the help shortcut below any time to open the full help dialog. The README, this tour, and the nikcli docs are also linked from the dialog. Have fun!",
  },
]

export function DialogTour() {
  const dialog = useDialog()
  const { theme } = useTheme()
  const keybind = useKeybind()
  const [index, setIndex] = createSignal(0)
  const total = STEPS.length
  const step = () => STEPS[index()]

  useKeyboard((evt) => {
    if (evt.name === "escape") {
      dialog.clear()
      return
    }
    if (evt.name === "right" || evt.name === "tab" || evt.name === "space" || evt.name === "return") {
      evt.preventDefault()
      if (index() >= total - 1) dialog.clear()
      else setIndex(index() + 1)
      return
    }
    if (evt.name === "left") {
      evt.preventDefault()
      if (index() > 0) setIndex(index() - 1)
    }
  })

  return (
    <box paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1} gap={1} flexDirection="column">
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.foreground.default}>
          Tour — {step().title}
        </text>
        <text fg={theme.foreground.muted}>
          {index() + 1} / {total} · ←/→ navigate · esc to exit
        </text>
      </box>

      <box flexDirection="column" gap={1} paddingTop={1} paddingBottom={1}>
        <text fg={theme.foreground.default}>{step().body}</text>
        <Show when={step() === STEPS[2]}>
          <text fg={theme.accent.alt}>Press {keybind.print("command_list")} to open it now.</text>
        </Show>
        <Show when={step() === STEPS[5]}>
          <text fg={theme.accent.alt}>Press ? to open help any time.</text>
        </Show>
      </box>

      <box flexDirection="row" gap={1} paddingTop={1}>
        <For each={STEPS}>{(_s, i) => <text fg={i() === index() ? theme.accent.fg : theme.foreground.muted}>●</text>}</For>
        <box flexGrow={1} />
        <box
          paddingLeft={2}
          paddingRight={2}
          backgroundColor={index() > 0 ? theme.surface.panel : undefined}
          onMouseUp={() => index() > 0 && setIndex(index() - 1)}
        >
          <text fg={index() > 0 ? theme.foreground.default : theme.foreground.muted}>← Back</text>
        </box>
        <box
          paddingLeft={2}
          paddingRight={2}
          backgroundColor={theme.accent.fg}
          onMouseUp={() => {
            if (index() >= total - 1) dialog.clear()
            else setIndex(index() + 1)
          }}
        >
          <text fg={theme.badge.fg}>{index() >= total - 1 ? "Finish" : "Next →"}</text>
        </box>
      </box>
    </box>
  )
}
