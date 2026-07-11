export type TerminalLaunchIntent = {
  cwd?: string
  title?: string
  sessionId?: string
  /** Optional command to spawn instead of the login shell (e.g. "nikcli"). */
  command?: string
  args?: string[]
}

let pending: TerminalLaunchIntent | null = null

export function setTerminalLaunchIntent(intent: TerminalLaunchIntent): void {
  pending = intent
}

export function consumeTerminalLaunchIntent(): TerminalLaunchIntent | null {
  const value = pending
  pending = null
  return value
}
