import { readFileSync } from "fs"
import fs from "fs/promises"
import path from "path"
import { Global } from "./global"

/**
 * The signed-in account token this machine holds.
 *
 * A four-function file store that sat inside `UserDB` and touched none of its
 * tables. Reaching it from the terminal pulled in drizzle and the whole user
 * schema to read one line of text — the pattern `specs/tui-package.md` §3 names:
 * when the TUI wants one small pure thing out of a backend namespace, extract
 * the thing, not the namespace.
 *
 * This deliberately stays client-side rather than moving behind an endpoint.
 * The token *is* what the terminal presents to authenticate; a server cannot
 * answer "which session does this machine hold" without already having it. It
 * is also the one credential read that must work before any transport does,
 * which is why `getSync` exists at all.
 */
export namespace UserSession {
  const FILE = path.join(Global.Path.data, "user-session.token")

  export async function get(): Promise<string | null> {
    try {
      const token = await Bun.file(FILE).text()
      return token.trim() || null
    } catch {
      return null
    }
  }

  /** Readable during render, before any transport exists. */
  export function getSync(): string | null {
    try {
      const token = readFileSync(FILE, "utf8").trim()
      return token || null
    } catch {
      return null
    }
  }

  export async function save(token: string): Promise<void> {
    await Bun.write(FILE, token)
    // chmod is Unix-only, skip on Windows
    if (process.platform !== "win32") {
      await fs.chmod(FILE, 0o600).catch(() => undefined)
    }
  }

  export async function clear(): Promise<void> {
    await fs.unlink(FILE).catch(() => undefined)
  }
}
