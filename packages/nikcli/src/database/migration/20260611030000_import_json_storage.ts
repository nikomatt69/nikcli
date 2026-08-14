import { Database as BunDatabase } from "bun:sqlite"
import fs from "fs"
import path from "path"
import { Log } from "@nikcli-ai/util/log"
import type { DatabaseMigration } from "../migration"

const log = Log.create({ service: "database-migration.json-import" })

/**
 * Data migration: backfill JSON storage records into the SQL read models
 * introduced by 20260611000000_session_message_todo_permission.
 *
 * Legacy layout (relative to the directory holding the main database file):
 *
 * - `storage/session/<projectID>/<sessionID>.json` — Session.Info
 * - `storage/message/<sessionID>/<messageID>.json` — MessageV2.Info
 * - `storage/part/<messageID>/<partID>.json` — MessageV2.Part
 * - `storage/todo/<sessionID>.json` — Todo.Info[]
 * - `storage/permission/<projectID>.json` — PermissionNext.Ruleset
 *
 * JSON files are left in place as the rollout fallback; existing SQL rows win
 * via INSERT OR IGNORE so the migration stays idempotent even if records were
 * already written through the repositories.
 */

function readJson(file: string): any | undefined {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"))
  } catch (error) {
    log.warn("skipping unreadable JSON record", { file, error: String(error) })
    return undefined
  }
}

function listDirs(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
}

function listJsonFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name)
}

export default {
  id: "20260611030000_import_json_storage",
  up(database: BunDatabase) {
    const filename = database.filename
    if (!filename || filename === ":memory:") return
    const storageDir = path.join(path.dirname(filename), "storage")
    if (!fs.existsSync(storageDir)) return

    // Sessions
    const insertSession = database.query(
      `INSERT OR IGNORE INTO session_info
       (id, project_id, title, directory, parent_id, workspace_id, version, data, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    let sessions = 0
    const sessionRoot = path.join(storageDir, "session")
    for (const projectID of listDirs(sessionRoot)) {
      for (const file of listJsonFiles(path.join(sessionRoot, projectID))) {
        const info = readJson(path.join(sessionRoot, projectID, file))
        if (!info?.id) continue
        const created = info.time?.created ?? Date.now()
        insertSession.run(
          info.id,
          info.projectID ?? projectID,
          info.title ?? "",
          info.directory ?? "",
          info.parentID ?? null,
          info.workspaceID ?? null,
          info.version ?? "",
          JSON.stringify(info),
          created,
          info.time?.updated ?? created,
        )
        sessions++
      }
    }

    // Messages — message_info has a foreign key on session_info, so only
    // import messages whose session exists after the session backfill.
    const knownSessions = new Set(
      database
        .query<{ id: string }, []>("SELECT id FROM session_info")
        .all()
        .map((row) => row.id),
    )
    const insertMessage = database.query(
      `INSERT OR IGNORE INTO message_info (id, session_id, role, info, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    let messages = 0
    const knownMessages = new Set<string>()
    const messageRoot = path.join(storageDir, "message")
    for (const sessionID of listDirs(messageRoot)) {
      if (!knownSessions.has(sessionID)) continue
      for (const file of listJsonFiles(path.join(messageRoot, sessionID))) {
        const info = readJson(path.join(messageRoot, sessionID, file))
        if (!info?.id || !info.role) continue
        insertMessage.run(info.id, sessionID, info.role, JSON.stringify(info), info.time?.created ?? 0)
        knownMessages.add(info.id)
        messages++
      }
    }

    // Parts — sort_key mirrors MessageRepo.upsertPart (the part ID, which is
    // monotonic per Identifier ordering).
    const insertPart = database.query(
      `INSERT OR IGNORE INTO message_part (id, message_id, session_id, type, info, sort_key)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    let parts = 0
    const partRoot = path.join(storageDir, "part")
    for (const messageID of listDirs(partRoot)) {
      if (!knownMessages.has(messageID)) continue
      for (const file of listJsonFiles(path.join(partRoot, messageID))) {
        const part = readJson(path.join(partRoot, messageID, file))
        if (!part?.id || !part.type) continue
        insertPart.run(part.id, messageID, part.sessionID ?? "", part.type, JSON.stringify(part), part.id)
        parts++
      }
    }

    // Todos
    const insertTodo = database.query("INSERT OR IGNORE INTO todo_info (session_id, todos) VALUES (?, ?)")
    let todos = 0
    const todoRoot = path.join(storageDir, "todo")
    for (const file of listJsonFiles(todoRoot)) {
      const content = readJson(path.join(todoRoot, file))
      if (!Array.isArray(content)) continue
      insertTodo.run(path.basename(file, ".json"), JSON.stringify(content))
      todos++
    }

    // Permission rulesets
    const insertRuleset = database.query("INSERT OR IGNORE INTO permission_ruleset (project_id, rules) VALUES (?, ?)")
    let rulesets = 0
    const permissionRoot = path.join(storageDir, "permission")
    for (const file of listJsonFiles(permissionRoot)) {
      const content = readJson(path.join(permissionRoot, file))
      if (!Array.isArray(content)) continue
      insertRuleset.run(path.basename(file, ".json"), JSON.stringify(content))
      rulesets++
    }

    if (sessions + messages + parts + todos + rulesets > 0)
      log.info("imported JSON storage records", {
        sessions,
        messages,
        parts,
        todos,
        rulesets,
      })
  },
} satisfies DatabaseMigration.Migration
