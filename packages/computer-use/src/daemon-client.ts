/**
 * Daemon client — resolves the per-workspace daemon socket, starts the daemon
 * on first use, and speaks the RPC protocol implemented in `daemon.ts` over
 * that Unix socket.
 *
 * Mirrors `@nikcli-ai/browser-control`'s `daemon-client.ts` one-to-one,
 * including the in-process fallback for compiled nikcli binaries.
 */
import { createHash } from "node:crypto"
import { access, constants, lstat } from "node:fs/promises"
import { basename, dirname, join, resolve } from "node:path"
import { tmpdir } from "node:os"

/** @deprecated Kept for callers/tests that still check the flag name. */
export const INTERNAL_DAEMON_FLAG = "--computer-use-daemon"

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
  return join(tmpdir(), `computer-use-${hash}.sock`)
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
  throw new Error(`computer-use daemon did not come up on ${socketPath}`)
}

function bunExecutable(): string {
  const exec = process.execPath
  const name = basename(exec).toLowerCase()
  if (name === "bun" || name.startsWith("bun-")) return exec
  return Bun.which("bun") ?? "bun"
}

/** True when this module lives inside a Bun compiled executable's virtual FS. */
export function isCompiledBinaryHost(dir = import.meta.dir): boolean {
  return dir.includes("$bunfs") || dir.includes("~BUN") || dir.includes("\\~BUN")
}

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

  if (inprocessStarts.has(socketPath) && !(await isDaemonAlive(socketPath))) {
    inprocessStarts.delete(socketPath)
  }

  const launch = await resolveDaemonLaunch()

  if (launch.mode === "inprocess") {
    await startInProcess(socketPath)
    if (!(await isDaemonAlive(socketPath))) {
      throw new Error(`computer-use daemon did not come up on ${socketPath} (in-process)`)
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
  if (!body.ok) throw new Error(body.error ?? `computer-use RPC "${method}" failed.`)
  return body.result as T
}

export async function shutdownDaemon(socketPath: string): Promise<void> {
  if (!(await isDaemonAlive(socketPath))) return
  await fetch("http://localhost/shutdown", {
    method: "POST",
    unix: socketPath,
  } as RequestInit).catch(() => {})
  inprocessStarts.delete(socketPath)
}
