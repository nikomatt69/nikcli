import { TextAttributes } from "@opentui/core"
import { useTheme } from "@tui/context/theme"
import { useDialog } from "@tui/ui/dialog"
import { useKeyboard } from "@opentui/solid"

/**
 * Cross-platform "open URL in the user's default browser" helper. Falls back
 * to a no-op (the caller's UI shows the URL) when no opener is available.
 */
export async function openExternal(url: string): Promise<void> {
  try {
    const { spawn } = await import("bun")
    const cmd =
      process.platform === "darwin"
        ? ["open", url]
        : process.platform === "win32"
          ? ["cmd", "/c", "start", "", url]
          : ["xdg-open", url]
    const proc = spawn({ cmd, stdout: "ignore", stderr: "ignore" })
    await proc.exited
  } catch {
    // best-effort; the dialog already shows the URL.
  }
}

function Header(props: { title: string; subtitle?: string }) {
  const { theme } = useTheme()
  return (
    <box flexDirection="row" justifyContent="space-between">
      <text attributes={TextAttributes.BOLD} fg={theme.text}>
        {props.title}
      </text>
      {props.subtitle ? <text fg={theme.textMuted}>{props.subtitle}</text> : null}
    </box>
  )
}

function Body(props: { children: string }) {
  const { theme } = useTheme()
  return (
    <text fg={theme.text} attributes={0}>
      {props.children}
    </text>
  )
}

function Footer(props: { left?: string; right?: string }) {
  const dialog = useDialog()
  const { theme } = useTheme()
  return (
    <box flexDirection="row" justifyContent="space-between" paddingTop={1}>
      <text fg={theme.textMuted}>{props.left ?? ""}</text>
      <box paddingLeft={3} paddingRight={3} backgroundColor={theme.primary} onMouseUp={() => dialog.clear()}>
        <text fg={theme.selectedListItemText}>{props.right ?? "Close"}</text>
      </box>
    </box>
  )
}

function useEscapeCloses() {
  const dialog = useDialog()
  useKeyboard((evt) => {
    if (evt.name === "escape" || evt.name === "return") {
      evt.preventDefault()
      dialog.clear()
    }
  })
}

export function DialogQuickstartInfo() {
  useEscapeCloses()
  return (
    <box paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1} gap={1} flexDirection="column">
      <Header title="Quickstart" subtitle="60-second first-time tour" />
      <Body
        children={
          "Run `nikcli quickstart` in your shell. It walks you through:\n  1. Connecting a provider (or skipping)\n  2. Picking a starter action\n  3. Launching the TUI, a one-shot prompt, or a model browser\n\nThe quickstart re-execs into the chosen command, so you don't have to copy/paste."
        }
      />
      <Footer left="Tip: type /quickstart in the TUI to launch the same flow" />
    </box>
  )
}

export function DialogDoctorInfo() {
  useEscapeCloses()
  return (
    <box paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1} gap={1} flexDirection="column">
      <Header title="Doctor" subtitle="diagnose common setup issues" />
      <Body
        children={
          "Run `nikcli doctor` in your shell. It checks:\n  - Version & runtime\n  - TTY (warns when piped)\n  - PATH (suggests fix if the exec dir is missing)\n  - Disk space (warns when < 5% free)\n  - Config validity (JSON parse)\n  - Deprecated config keys (e.g. `keybinds` → `keymappings`)\n\nUse --json for a structured report."
        }
      />
      <Footer left="Tip: type /doctor in the TUI to launch the same flow" />
    </box>
  )
}
