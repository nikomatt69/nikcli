import { bunUtils } from "./bun-utils"

export type PtyExitEvent = { exitCode: number; signal?: number }

export interface NativePty {
  readonly pid: number
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(signal?: string): void
  onData(callback: (data: string) => void): void
  onExit(callback: (event: PtyExitEvent) => void): void
}

export interface NativePtyOptions {
  command: string
  args?: readonly string[]
  cwd?: string
  env?: Record<string, string | undefined>
  cols?: number
  rows?: number
}

function envRecord(env: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) out[key] = value
  }
  return out
}

/**
 * Spawn a child with a real PTY (POSIX) / ConPTY (Windows).
 *
 * `write()` returns the full buffered length from Bun — do not treat that as
 * "bytes accepted" and re-send, or input is duplicated.
 */
export function spawnPty(options: NativePtyOptions): NativePty {
  const decoder = new TextDecoder("utf-8", { fatal: false })
  const dataListeners = new Set<(data: string) => void>()
  const exitListeners = new Set<(event: PtyExitEvent) => void>()
  let exited = false

  const emitData = (chunk: Uint8Array) => {
    const text = decoder.decode(chunk, { stream: true })
    if (!text) return
    for (const listener of dataListeners) listener(text)
  }

  const emitExit = (exitCode: number) => {
    if (exited) return
    exited = true
    const flush = decoder.decode()
    if (flush) {
      for (const listener of dataListeners) listener(flush)
    }
    for (const listener of exitListeners) listener({ exitCode })
  }

  const proc = bunUtils.spawn([options.command, ...(options.args ?? [])], {
    cwd: options.cwd,
    env: envRecord(options.env ?? {}),
    windowsHide: true,
    terminal: {
      cols: options.cols ?? 80,
      rows: options.rows ?? 24,
      data(_terminal, data) {
        emitData(data)
      },
    },
  })

  const terminal = proc.terminal
  if (!terminal) throw new Error("Bun.spawn did not attach a terminal")

  void proc.exited.then((code) => {
    emitExit(code)
    try {
      terminal.close()
    } catch {}
  })

  return {
    get pid() {
      return proc.pid
    },
    write(data: string) {
      terminal.write(data)
    },
    resize(cols: number, rows: number) {
      terminal.resize(cols, rows)
    },
    kill(signal?: string) {
      try {
        proc.kill((signal as NodeJS.Signals | undefined) ?? "SIGTERM")
      } catch {}
      try {
        terminal.close()
      } catch {}
    },
    onData(callback) {
      dataListeners.add(callback)
    },
    onExit(callback) {
      exitListeners.add(callback)
    },
  }
}
