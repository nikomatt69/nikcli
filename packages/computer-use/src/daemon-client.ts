/**
 * Daemon client — resolves the per-workspace daemon socket, spawns the
 * daemon in the background on first use (detached via `.unref()` so the CLI
 * process that triggered it can exit immediately), and speaks the RPC
 * protocol implemented in `daemon.ts` over that Unix socket.
 *
 * Mirrors `@nikcli-ai/browser-control`'s `daemon-client.ts` one-to-one.
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

async function waitForDaemon(socketPath: string, attempts = 40): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    if (await isDaemonAlive(socketPath)) return
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(`computer-use daemon did not come up on ${socketPath}`)
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
  if (!body.ok) throw new Error(body.error ?? `computer-use RPC "${method}" failed.`)
  return body.result as T
}

export async function shutdownDaemon(socketPath: string): Promise<void> {
  if (!(await isDaemonAlive(socketPath))) return
  await fetch("http://localhost/shutdown", {
    method: "POST",
    unix: socketPath,
  } as RequestInit).catch(() => {})
}
