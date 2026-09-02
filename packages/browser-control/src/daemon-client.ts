/**
 * Daemon client — resolves the per-workspace daemon socket, starts the daemon
 * on first use, and speaks the RPC protocol implemented in `daemon.ts` over
 * that Unix socket.
 *
 * Start strategy:
 * - **Source / dev** (`bun run dev`): spawn `daemon.ts` with bun so the daemon
 *   outlives a short CLI invocation.
 * - **Compiled nikcli binary**: sources live under virtual `/$bunfs/root/`, so
 *   there is no real `daemon.ts` on disk, and re-execing the 200MB+ binary just
 *   to host the socket is killed by the OS (SIGKILL / OOM). Instead, start the
 *   daemon **in-process** — the TUI (or tool) already has Bun.WebView in the
 *   module graph, and `BrowserSurface` tears the session down on unmount.
 * - **In-process, but called from a worker thread**: hand the binding to the
 *   host's main thread via {@link setMainThreadDaemonHost}. Bun.WebView cannot
 *   be constructed off the main thread, so a daemon hosted on a worker would
 *   answer `list` and fail every `start`.
 */
import { createHash } from "node:crypto"
import { access, constants, lstat } from "node:fs/promises"
import { basename, dirname, join, resolve } from "node:path"
import { tmpdir } from "node:os"
import { isMainThread } from "node:worker_threads"

/** @deprecated Kept for callers/tests that still check the flag name. */
export const INTERNAL_DAEMON_FLAG = "--browser-control-daemon"

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

async function waitForDaemon(socketPath: string, attempts = 150): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    if (await isDaemonAlive(socketPath)) return
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(`browser-control daemon did not come up on ${socketPath}`)
}

function bunExecutable(): string {
  const exec = process.execPath
  const name = basename(exec).toLowerCase()
  if (name === "bun" || name.startsWith("bun-")) return exec
  return Bun.which("bun") ?? "bun"
}

/** True when this module lives inside a Bun compiled executable's virtual FS. */
export function isCompiledBinaryHost(dir = import.meta.dir): boolean {
  // Bun embeds sources under `/$bunfs/root/...` (Unix) or `B:\~BUN\root\...` (Windows).
  // Those paths are not real files `bun <path>` can execute as a child process.
  return dir.includes("$bunfs") || dir.includes("~BUN") || dir.includes("\\~BUN")
}

/**
 * Resolve how the daemon should be started. Exported for tests.
 *
 * - `{ mode: "spawn", argv }` when `daemon.ts` is a real file (dev).
 * - `{ mode: "inprocess" }` inside a compiled binary (virtual bunfs path).
 */
export async function resolveDaemonLaunch(): Promise<
  { mode: "spawn"; argv: (socketPath: string) => string[] } | { mode: "inprocess" }
> {
  if (isCompiledBinaryHost()) return { mode: "inprocess" }

  const daemonEntry = resolve(import.meta.dir, "daemon.ts")
  const entryOnDisk = await access(daemonEntry, constants.R_OK)
    .then(() => true)
    .catch(() => false)

  if (entryOnDisk) {
    return {
      mode: "spawn",
      argv: (socketPath) => [bunExecutable(), daemonEntry, "--socket", socketPath],
    }
  }
  return { mode: "inprocess" }
}

/** @deprecated Prefer {@link resolveDaemonLaunch}. */
export async function resolveDaemonSpawn(socketPath: string): Promise<string[]> {
  const launch = await resolveDaemonLaunch()
  if (launch.mode === "spawn") return launch.argv(socketPath)
  return [process.execPath, INTERNAL_DAEMON_FLAG, "--socket", socketPath]
}

async function readStderrSnippet(proc: Bun.Subprocess, limit = 800): Promise<string> {
  const stream = proc.stderr
  if (!stream || typeof stream === "number") return ""
  try {
    const reader = (stream as ReadableStream<Uint8Array>).getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    const deadline = Date.now() + 200
    while (total < limit && Date.now() < deadline) {
      const remaining = Math.max(1, deadline - Date.now())
      const result = await Promise.race([
        reader.read(),
        new Promise<{ done: true; value: undefined }>((resolve) =>
          setTimeout(() => resolve({ done: true, value: undefined }), remaining),
        ),
      ])
      if (result.done || !result.value) break
      chunks.push(result.value)
      total += result.value.byteLength
    }
    reader.releaseLock()
    if (chunks.length === 0) return ""
    const merged = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      merged.set(chunk, offset)
      offset += chunk.byteLength
    }
    return new TextDecoder().decode(merged).trim().slice(0, limit)
  } catch {
    return ""
  }
}

/**
 * Ask the host's main thread to bind the daemon for us.
 *
 * `Bun.WebView`'s chrome backend — the backend everywhere except macOS —
 * throws `only available on the main thread` when constructed from a worker,
 * and it throws at *construction*, so connecting to an already-running Chrome
 * over a DevTools URL does not dodge it either. A daemon hosted in-process on a
 * worker therefore answers `list` fine and fails every `start`.
 *
 * A host that runs sessions on a worker (nikcli's TUI does) registers this so
 * the daemon binds on its main thread instead; the worker then talks to it over
 * the same socket as any other client, and views are created where they are
 * allowed to exist.
 */
export type MainThreadDaemonHost = (socketPath: string) => void

let mainThreadHost: MainThreadDaemonHost | undefined

export function setMainThreadDaemonHost(host: MainThreadDaemonHost | undefined): void {
  mainThreadHost = host
}

/**
 * Who binds an in-process daemon. Pure, and exported, so the rule is checked
 * without a compiled binary and a browser to hand.
 *
 * - `self` — this thread can host: it owns the main thread.
 * - `delegate` — a worker with a registered host; ask it and wait for the socket.
 * - `unsupported` — a worker with nowhere to delegate to. Hosting here would
 *   bind a socket that fails every `start`, which is worse than not binding.
 */
export function inprocessHostingPlan(options: {
  readonly mainThread: boolean
  readonly hasMainThreadHost: boolean
}): "self" | "delegate" | "unsupported" {
  if (options.mainThread) return "self"
  return options.hasMainThreadHost ? "delegate" : "unsupported"
}

/** Tracks in-process starts so concurrent ensureDaemon calls share one server. */
const inprocessStarts = new Map<string, Promise<void>>()

async function startInProcess(socketPath: string): Promise<void> {
  const existing = inprocessStarts.get(socketPath)
  if (existing) {
    await existing
    return
  }
  const boot = (async () => {
    const { startDaemon } = await import("./daemon")
    // Never process.exit from inside the host TUI/CLI process.
    await startDaemon(socketPath, { exitProcess: false })
  })()
  inprocessStarts.set(socketPath, boot)
  try {
    await boot
  } catch (error) {
    inprocessStarts.delete(socketPath)
    throw error
  }
}

export async function ensureDaemon(socketPath: string): Promise<void> {
  if (await isDaemonAlive(socketPath)) return

  // An in-process server may have idle-shut down while the host process stayed
  // up — drop the stale boot promise so we can bind again.
  if (inprocessStarts.has(socketPath) && !(await isDaemonAlive(socketPath))) {
    inprocessStarts.delete(socketPath)
  }

  const launch = await resolveDaemonLaunch()

  if (launch.mode === "inprocess") {
    // Hosting here would put every Bun.WebView on this thread. Off the main
    // thread that is not allowed, so hand the job to whoever owns the main one.
    const plan = inprocessHostingPlan({ mainThread: isMainThread, hasMainThreadHost: mainThreadHost !== undefined })

    if (plan === "unsupported") {
      throw new Error(
        `browser-control cannot host a browser on a worker thread: Bun.WebView is main-thread only. ` +
          `The host must call setMainThreadDaemonHost() from its main thread.`,
      )
    }

    if (plan === "delegate") {
      mainThreadHost!(socketPath)
      await waitForDaemon(socketPath)
      return
    }

    // startDaemon resolves once Bun.serve is listening; no wait loop needed.
    await startInProcess(socketPath)
    if (!(await isDaemonAlive(socketPath))) {
      throw new Error(`browser-control daemon did not come up on ${socketPath} (in-process)`)
    }
    return
  }

  const argv = launch.argv(socketPath)
  const proc = Bun.spawn(argv, {
    stdin: "ignore",
    stdout: "ignore",
    stderr: "pipe",
    env: process.env,
  })
  proc.unref()

  try {
    await waitForDaemon(socketPath)
  } catch (error) {
    const stderr = await readStderrSnippet(proc)
    const detail = stderr || (proc.exitCode !== null ? `exited ${proc.exitCode}` : `spawn: ${argv.join(" ")}`)
    const base = error instanceof Error ? error.message : String(error)
    throw new Error(`${base} (${detail})`)
  }
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
  inprocessStarts.delete(socketPath)
}
