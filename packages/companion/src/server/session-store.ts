import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from "fs"
import os from "os"
import { join } from "path"
import type { Session } from "./session-types.js"

const SESSIONS_DIR = join(os.tmpdir(), "nikcli-sessions")

function ensureDir() {
  if (!existsSync(SESSIONS_DIR)) {
    mkdirSync(SESSIONS_DIR, { recursive: true })
  }
}

export function getSessionPath(sessionId: string): string {
  ensureDir()
  return join(SESSIONS_DIR, `${sessionId}.json`)
}

export function saveSession(session: Session): void {
  const path = getSessionPath(session.id)
  writeFileSync(path, JSON.stringify(session, null, 2))
}

export function loadSession(sessionId: string): Session | null {
  const path = getSessionPath(sessionId)
  if (!existsSync(path)) return null
  try {
    const data = readFileSync(path, "utf-8")
    return JSON.parse(data)
  } catch {
    return null
  }
}

export function listSessions(): Session[] {
  ensureDir()
  const files = readdirSync(SESSIONS_DIR).filter((f) => f.endsWith(".json"))
  const sessions: Session[] = []
  for (const file of files) {
    try {
      const data = readFileSync(join(SESSIONS_DIR, file), "utf-8")
      sessions.push(JSON.parse(data))
    } catch {
      // skip invalid files
    }
  }
  return sessions.sort((a, b) => b.updatedAt - a.updatedAt)
}

export function deleteSession(sessionId: string): void {
  const path = getSessionPath(sessionId)
  if (existsSync(path)) {
    rmSync(path)
  }
}

export function clearAllSessions(): void {
  if (existsSync(SESSIONS_DIR)) {
    const files = readdirSync(SESSIONS_DIR).filter((f) => f.endsWith(".json"))
    for (const file of files) {
      rmSync(join(SESSIONS_DIR, file))
    }
  }
}
