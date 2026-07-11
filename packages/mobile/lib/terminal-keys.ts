export type TerminalKeyAction = {
  id: string
  label: string
  data: string
  sticky?: "ctrl" | "shift"
  accent?: boolean
  /** Special UI action handled by RN (not sent to PTY). */
  action?: "hide-keyboard"
}

export const TERMINAL_DOCKED_KEYS: TerminalKeyAction[] = [
  { id: "tab", label: "Tab", data: "\t" },
  { id: "esc", label: "Esc", data: "\x1b" },
  { id: "ctrl", label: "Ctrl", data: "", sticky: "ctrl" },
  { id: "shift", label: "Shift", data: "", sticky: "shift" },
  { id: "up", label: "↑", data: "\x1b[A" },
  { id: "down", label: "↓", data: "\x1b[B" },
  { id: "left", label: "←", data: "\x1b[D" },
  { id: "right", label: "→", data: "\x1b[C" },
  { id: "home", label: "Home", data: "\x01" },
  { id: "end", label: "End", data: "\x05" },
  { id: "ctrl-w", label: "Ctrl+W", data: "\x17", accent: true },
  { id: "ctrl-c", label: "Ctrl+C", data: "\x03", accent: true },
  { id: "ctrl-p", label: "Ctrl+P", data: "\x10", accent: true },
  { id: "ctrl-u", label: "Ctrl+U", data: "\x15", accent: true },
  { id: "ctrl-d", label: "Ctrl+D", data: "\x04", accent: true },
  { id: "ctrl-l", label: "Ctrl+L", data: "\x0c", accent: true },
  { id: "pgup", label: "PgUp", data: "\x1b[5~" },
  { id: "pgdn", label: "PgDn", data: "\x1b[6~" },
  { id: "pipe", label: "|", data: "|" },
  { id: "tilde", label: "~", data: "~" },
  { id: "slash", label: "/", data: "/" },
  { id: "hide-kb", label: "KB↓", data: "", action: "hide-keyboard" },
]

/** @deprecated Use TERMINAL_DOCKED_KEYS — single keybar source of truth. */
export const TERMINAL_ACCESSORY_KEYS = TERMINAL_DOCKED_KEYS

function ctrlChar(char: string): string {
  const code = char.toUpperCase().charCodeAt(0)
  if (code >= 65 && code <= 90) return String.fromCharCode(code - 64)
  return char
}

export function resolveTerminalKeyInput(
  key: TerminalKeyAction,
  modifiers: { ctrl: boolean; shift: boolean },
): {
  data: string | null
  action: TerminalKeyAction["action"] | null
  nextModifiers: { ctrl: boolean; shift: boolean }
} {
  if (key.action) {
    return { data: null, action: key.action, nextModifiers: modifiers }
  }
  if (key.sticky === "ctrl") {
    return { data: null, action: null, nextModifiers: { ctrl: !modifiers.ctrl, shift: false } }
  }
  if (key.sticky === "shift") {
    return { data: null, action: null, nextModifiers: { ctrl: modifiers.ctrl, shift: !modifiers.shift } }
  }

  let data = key.data
  if (modifiers.ctrl && data.length === 1) data = ctrlChar(data)
  if (modifiers.shift && data.length === 1 && /[a-z]/.test(data)) data = data.toUpperCase()
  if (modifiers.shift && data === "\t") data = "\x1b[Z"

  return { data, action: null, nextModifiers: { ctrl: false, shift: false } }
}

export type PtyConnectionStatus = "connecting" | "connected" | "disconnected" | "error" | "exited"

export function ptyStatusLabel(status: PtyConnectionStatus): string {
  if (status === "connected") return "Connected"
  if (status === "connecting") return "Connecting"
  if (status === "disconnected") return "Disconnected"
  if (status === "exited") return "Exited"
  return "Connection error"
}

export function ptyStatusColor(status: PtyConnectionStatus): string {
  if (status === "connected") return "#3fb950"
  if (status === "connecting") return "#d29922"
  if (status === "disconnected") return "#58a6ff"
  if (status === "exited") return "#6e7681"
  return "#ff7b72"
}
