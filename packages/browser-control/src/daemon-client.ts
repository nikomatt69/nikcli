/**
 * Daemon client — resolves the per-workspace daemon socket, spawns the daemon
 * in the background on first use (detached via `.unref()` so the CLI process
 * that triggered it can exit immediately), and speaks the RPC protocol
 * implemented in `daemon.ts` over that Unix socket.
 */
import { createHash } from "node:crypto"
import { lstat } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { tmpdir } from "node:os"

async function findWorkspaceRoot(start = process.cwd()): Promise<string> {
  let current = resolve(start)
  while (true) {
    if (await lstat(join(current, ".git")).catch(() => undefined)) return current
    const parent = dirname(current)
    if (parent === current) return resolve(start)
    current = parent
  }
}

export async function socketPathFor(workspace?: string): Promise<string> {
  const root = workspace ? resolve(workspace) : await findWorkspaceRoot()
  const hash = createHash("sha1").update(root).digest("hex").slice(0, 16)
  return join(tmpdir(), `browser-control-${hash}.sock`)
}

async function isDaemonAlive(socketPath: string): Promise<boolean> {
  try {
    const res = await fetch("http://localhost/health", {
      unix: socketPath,
      signal: AbortSignal.timeout(500),
    } as RequestInit)
    return res.ok
  } catch {
    return false
  }
}

async function waitForDaemon(socketPath: string, attempts = 40): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    if (await isDaemonAlive(socketPath)) return
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(`browser-control daemon did not come up on ${socketPath}`)
}

export async function ensureDaemon(socketPath: string): Promise<void> {
  if (await isDaemonAlive(socketPath)) return
  const daemonEntry = resolve(import.meta.dir, "daemon.ts")
  const proc = Bun.spawn(["bun", daemonEntry, "--socket", socketPath], {
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  })
  proc.unref()
  await waitForDaemon(socketPath)
}

export interface RpcResponse<T> {
  readonly ok: boolean
  readonly result?: T
  readonly error?: string
}

export async function rpc<T = unknown>(
  socketPath: string,
  method: string,
  params?: Record<string, unknown>,
): Promise<T> {
  const res = await fetch("http://localhost/rpc", {
    method: "POST",
    unix: socketPath,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ method, params: params ?? {} }),
  } as RequestInit)
  const body = (await res.json()) as RpcResponse<T>
  if (!body.ok) throw new Error(body.error ?? `browser-control RPC "${method}" failed.`)
  return body.result as T
}

/** One NDJSON line from `GET /screencast`. Exactly one of `path` / `pngBase64` is set. */
export interface ScreencastStreamFrame {
  readonly seq: number
  readonly width: number
  readonly height: number
  readonly deviceWidth: number
  readonly deviceHeight: number
  readonly scrollOffsetX: number
  readonly scrollOffsetY: number
  readonly pageScaleFactor: number
  readonly timestamp: number
  /** Absolute path to a PNG the terminal can read directly (`file` mode). */
  readonly path?: string
  /** Base64 PNG bytes (`inline` mode). */
  readonly pngBase64?: string
}

export interface OpenScreencastOptions {
  readonly name: string
  readonly mode?: "file" | "inline"
  readonly maxWidth?: number
  readonly maxHeight?: number
  readonly fps?: number
  readonly everyNthFrame?: number
  readonly signal?: AbortSignal
}

/**
 * Consume a session's live frame stream. Abort the passed signal (or stop
 * iterating) to close it — the daemon stops the screencast with the request.
 */
export async function* openScreencast(
  socketPath: string,
  options: OpenScreencastOptions,
): AsyncGenerator<ScreencastStreamFrame> {
  const query = new URLSearchParams({ name: options.name })
  if (options.mode) query.set("mode", options.mode)
  if (options.maxWidth) query.set("maxWidth", String(Math.round(options.maxWidth)))
  if (options.maxHeight) query.set("maxHeight", String(Math.round(options.maxHeight)))
  if (options.fps) query.set("fps", String(options.fps))
  if (options.everyNthFrame) query.set("everyNthFrame", String(options.everyNthFrame))

  const res = await fetch(`http://localhost/screencast?${query.toString()}`, {
    unix: socketPath,
    ...(options.signal ? { signal: options.signal } : {}),
  } as RequestInit)
  if (!res.ok || !res.body) {
    const body = (await res.json().catch(() => undefined)) as { error?: string } | undefined
    throw new Error(body?.error ?? `browser-control screencast failed with HTTP ${res.status}`)
  }

  const decoder = new TextDecoder()
  let buffer = ""
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true })
    let newline = buffer.indexOf("\n")
    while (newline !== -1) {
      const line = buffer.slice(0, newline)
      buffer = buffer.slice(newline + 1)
      newline = buffer.indexOf("\n")
      if (!line) continue
      const message = JSON.parse(line) as { type: string; error?: string } & ScreencastStreamFrame
      if (message.type === "error") throw new Error(message.error ?? "screencast failed")
      if (message.type === "frame") yield message
    }
  }
}

export async function shutdownDaemon(socketPath: string): Promise<void> {
  if (!(await isDaemonAlive(socketPath))) return
  await fetch("http://localhost/shutdown", { method: "POST", unix: socketPath } as RequestInit).catch(() => {})
}
