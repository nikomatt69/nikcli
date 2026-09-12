import { Session } from "@/session"
import { Locale } from "@nikcli-ai/util/locale"
import { Flag } from "@nikcli-ai/util/flag"
import { EOL } from "os"
import path from "path"
import { Effect } from "effect"
import { runPromiseWithLayer, withCurrentInstance } from "@/effect"

/** Helpers shared by the `session` commands. */

export function runSession<A, E>(effect: Effect.Effect<A, E, Session.Service>) {
  return runPromiseWithLayer(Session.defaultLayer, withCurrentInstance(effect))
}

export function pagerCmd(): string[] {
  const lessOptions = ["-R", "-S"]
  if (process.platform !== "win32") {
    return ["less", ...lessOptions]
  }

  const lessOnPath = Bun.which("less")
  if (lessOnPath) {
    if (Bun.file(lessOnPath).size) return [lessOnPath, ...lessOptions]
  }

  if (Flag.NIKCLI_GIT_BASH_PATH) {
    const less = path.join(Flag.NIKCLI_GIT_BASH_PATH, "..", "..", "usr", "bin", "less.exe")
    if (Bun.file(less).size) return [less, ...lessOptions]
  }

  const git = Bun.which("git")
  if (git) {
    const less = path.join(git, "..", "..", "usr", "bin", "less.exe")
    if (Bun.file(less).size) return [less, ...lessOptions]
  }

  return ["cmd", "/c", "more"]
}

export function formatSessionTable(sessions: Session.Info[]): string {
  const lines: string[] = []

  const maxIdWidth = Math.max(20, ...sessions.map((s) => s.id.length))
  const maxTitleWidth = Math.max(25, ...sessions.map((s) => s.title.length))

  const header = `Session ID${" ".repeat(maxIdWidth - 10)}  Title${" ".repeat(maxTitleWidth - 5)}  Updated`
  lines.push(header)
  lines.push("─".repeat(header.length))
  for (const session of sessions) {
    const truncatedTitle = Locale.truncate(session.title, maxTitleWidth)
    const timeStr = Locale.todayTimeOrDateTime(session.time.updated)
    const line = `${session.id.padEnd(maxIdWidth)}  ${truncatedTitle.padEnd(maxTitleWidth)}  ${timeStr}`
    lines.push(line)
  }

  return lines.join(EOL)
}

export function formatSessionJSON(sessions: Session.Info[]): string {
  const jsonData = sessions.map((session) => ({
    id: session.id,
    title: session.title,
    updated: session.time.updated,
    created: session.time.created,
    projectId: session.projectID,
    directory: session.directory,
  }))
  return JSON.stringify(jsonData, null, 2)
}
