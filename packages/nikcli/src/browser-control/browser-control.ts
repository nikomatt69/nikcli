import { Instance } from "@/project/instance"
import { ensureDaemon, rpc, shutdownDaemon, socketPathFor, type SessionInfo } from "@nikcli-ai/browser-control"

/**
 * Thin per-conversation binding onto `@nikcli-ai/browser-control`'s
 * background daemon: resolves the workspace socket once, and gives every
 * nikcli session a default browser-control session name so the
 * `browser_control` tool doesn't need one passed on every call (mirroring the
 * old "one browser session per conversation" convenience, without a cloud
 * session behind it).
 */
export namespace BrowserControl {
  /**
   * The daemon socket per workspace. Keyed by directory because one process
   * drives many instances — the server runs a worktree per session — and a
   * single module-level promise served whichever directory reached it first
   * to all of them, silently pointing later instances at the first one's
   * daemon.
   *
   * The `undefined` key is the shutdown path: `serve` stops the daemon
   * without standing in an instance scope, and `socketPathFor` resolves the
   * workspace root from `process.cwd()` when given nothing. That path used to
   * work only by accident, because an in-scope call had already filled the
   * global — on its own it would have thrown, since `Instance.directory`
   * raises outside a scope rather than answering `undefined`.
   */
  const sockets = new Map<string | undefined, Promise<string>>()

  /** R2 boundary: scoped callers plus unscoped shutdown; four external files would have to pass a directory. */
  function currentDirectory(): string | undefined {
    try {
      return Instance.directory
    } catch {
      return undefined
    }
  }

  function socket(): Promise<string> {
    const directory = currentDirectory()
    const existing = sockets.get(directory)
    if (existing) return existing
    const resolved = socketPathFor(directory)
    sockets.set(directory, resolved)
    return resolved
  }

  /** Ensure the background daemon for this workspace is up, and return its socket path. */
  export async function daemon(): Promise<string> {
    const path = await socket()
    await ensureDaemon(path)
    return path
  }

  /** Default session name for a nikcli conversation, unless the caller names one explicitly. */
  export function sessionName(nikcliSessionID: string, explicit?: string): string {
    return explicit && explicit.length > 0 ? explicit : `nikcli-${nikcliSessionID}`
  }

  export async function call<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    const path = await daemon()
    return rpc<T>(path, method, params)
  }

  /** Session info if one is currently registered under this name, else undefined. */
  export async function find(name: string): Promise<SessionInfo | undefined> {
    const path = await daemon()
    const list = await rpc<SessionInfo[]>(path, "list")
    return list.find((session) => session.name === name)
  }

  /**
   * Stop every session and every daemon this process resolved a socket for.
   *
   * Not just the caller's own: both shutdown callers — the TUI worker's
   * `shutdown` RPC and `serve`'s signal handler — run outside any instance
   * scope, and a session may have started a daemon for a worktree other than
   * the directory the process was launched in. Sweeping the map closes exactly
   * the daemons this process could have started, and nothing else.
   */
  export async function closeAll(): Promise<void> {
    // Resolve the caller's own workspace first so it is in the map even when
    // nothing in this process has talked to a daemon yet.
    await socket()
    const paths = new Set(await Promise.all(sockets.values()))
    await Promise.allSettled(Array.from(paths, (path) => shutdownDaemon(path)))
  }
}
