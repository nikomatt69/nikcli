import { TextAttributes } from "@opentui/core"
import { useTheme } from "@tui/context/theme"
import { useDialog } from "./dialog"
import { useKeyboard } from "@opentui/solid"
import { useKeybind } from "@tui/context/keybind"
import { For } from "solid-js"

const SHORTCUTS: Array<{ key: string; description: string }> = [
  { key: "command_list", description: "Open the command palette" },
  { key: "app_support", description: "Open the support assistant" },
  { key: "session_list", description: "List all sessions" },
  { key: "session_new", description: "Create a new session" },
  { key: "theme_list", description: "Switch theme" },
  { key: "status_view", description: "View status & usage" },
  { key: "model_favorite_toggle", description: "Cycle favorite models" },
  { key: "sidebar_toggle", description: "Toggle the sidebar" },
  { key: "app_exit", description: "Exit nikcli" },
]

const SLASH_COMMANDS: Array<{ name: string; description: string }> = [
  { name: "/help", description: "Show this dialog" },
  { name: "/support", description: "Chat with the support assistant" },
  { name: "/sessions", description: "Browse past sessions" },
  { name: "/models", description: "Pick a model" },
  { name: "/agents", description: "Pick an agent" },
  { name: "/skills", description: "Browse skills" },
  { name: "/mcps", description: "Manage MCP servers" },
  { name: "/themes", description: "Switch theme" },
  { name: "/status", description: "View runtime status" },
  { name: "/usage", description: "View token & cost usage" },
  { name: "/config", description: "Open configuration" },
  { name: "/auth", description: "Manage auth providers" },
  { name: "/connect", description: "Connect a provider" },
  { name: "/workspace", description: "Switch workspace" },
]

const CLI_COMMANDS: Array<{ name: string; description: string }> = [
  { name: "nikcli", description: "Open the TUI" },
  { name: "nikcli run <prompt>", description: "Run a one-shot prompt" },
  { name: "nikcli auth login", description: "Connect a provider" },
  { name: "nikcli models", description: "List configured models" },
  { name: "nikcli agents", description: "List configured agents" },
  { name: "nikcli session", description: "Manage sessions" },
  { name: "nikcli upgrade", description: "Self-upgrade" },
  { name: "nikcli --help", description: "Show all CLI commands" },
]

export function DialogHelp() {
  const dialog = useDialog()
  const { theme } = useTheme()
  const keybind = useKeybind()

  useKeyboard((evt) => {
    if (evt.name === "return" || evt.name === "escape") {
      dialog.clear()
    }
  })

  const columnWidth = 36

  return (
    <box paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1} gap={1} flexDirection="column">
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          Help
        </text>
        <text fg={theme.textMuted}>esc/enter to close</text>
      </box>

      <box flexDirection="row" gap={3}>
        <box flexDirection="column" gap={1} width={columnWidth}>
          <text attributes={TextAttributes.BOLD} fg={theme.primary}>
            Shortcuts
          </text>
          <For each={SHORTCUTS}>
            {(item) => (
              <box flexDirection="row" gap={1}>
                <text fg={theme.accent}>{keybind.print(item.key)}</text>
                <text fg={theme.textMuted}>— {item.description}</text>
              </box>
            )}
          </For>
        </box>

        <box flexDirection="column" gap={1} width={columnWidth}>
          <text attributes={TextAttributes.BOLD} fg={theme.primary}>
            Slash commands
          </text>
          <For each={SLASH_COMMANDS}>
            {(item) => (
              <box flexDirection="row" gap={1}>
                <text fg={theme.accent}>{item.name}</text>
                <text fg={theme.textMuted}>— {item.description}</text>
              </box>
            )}
          </For>
        </box>

        <box flexDirection="column" gap={1} width={columnWidth}>
          <text attributes={TextAttributes.BOLD} fg={theme.primary}>
            CLI
          </text>
          <For each={CLI_COMMANDS}>
            {(item) => (
              <box flexDirection="row" gap={1}>
                <text fg={theme.accent}>{item.name}</text>
                <text fg={theme.textMuted}>— {item.description}</text>
              </box>
            )}
          </For>
        </box>
      </box>

      <box paddingTop={1} flexDirection="row" justifyContent="space-between">
        <text fg={theme.textMuted}>
          Need more? See <span style={{ fg: theme.accent }}>https://nikcli.store/docs</span>
        </text>
        <text fg={theme.textMuted}>Press {keybind.print("command_list")} to open the command palette</text>
      </box>

      <box flexDirection="row" justifyContent="flex-end" paddingTop={1}>
        <box paddingLeft={3} paddingRight={3} backgroundColor={theme.primary} onMouseUp={() => dialog.clear()}>
          <text fg={theme.selectedListItemText}>OK</text>
        </box>
      </box>
    </box>
  )
}
