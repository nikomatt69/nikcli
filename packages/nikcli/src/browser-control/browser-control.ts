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
  let cachedSocket: Promise<string> | undefined

  function socket(): Promise<string> {
    if (!cachedSocket) cachedSocket = socketPathFor(Instance.directory)
    return cachedSocket
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

  /** Stop every session and the daemon itself. */
  export async function closeAll(): Promise<void> {
    await shutdownDaemon(await socket())
  }
}
