import { Database as BunDatabase } from "bun:sqlite"
import fs from "fs"
import path from "path"
import { Log } from "@/util/log"
import type { DatabaseMigration } from "../migration"

const log = Log.create({ service: "database-migration.domain" })

/**
 * Missions, monitors, shares, and artifacts move from JSON storage to SQL.
 *
 * Legacy layout (relative to the directory holding the main database file):
 *
 * - `storage/mission/<projectID>/<missionID>.json`
 * - `storage/mission_exec/<projectID>/<missionID>/<execID>.json`
 * - `storage/monitor/<sessionID>/<monitorID>.json`
 * - `storage/session_share/<sessionID>.json`
 * - `storage/local_share/<shareID>.json`
 * - `storage/artifact/<sessionID>/<artifactID>.json`
 *
 * JSON files are left in place as the downgrade fallback, and every insert is
 * `OR IGNORE`, so re-running this against a database whose journal was reset
 * cannot double-import.
 */

function readJson(file: string): any | undefined {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"))
  } catch (error) {
    log.warn("skipping unreadable domain record", { file, error: String(error) })
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

function importMissions(database: BunDatabase, storageDir: string) {
  const insertMission = database.query(
    `INSERT OR IGNORE INTO mission
     (id, project_id, name, status, data, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
  const insertExec = database.query(
    `INSERT OR IGNORE INTO mission_exec
     (id, mission_id, project_id, status, started_at, ended_at, data)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )

  let missions = 0
  const missionRoot = path.join(storageDir, "mission")
  for (const projectID of listDirs(missionRoot)) {
    for (const file of listJsonFiles(path.join(missionRoot, projectID))) {
      const def = readJson(path.join(missionRoot, projectID, file))
      if (!def?.id || typeof def.name !== "string") continue
      insertMission.run(
        def.id,
        projectID,
        def.name,
        typeof def.status === "string" ? def.status : "draft",
        JSON.stringify(def),
        typeof def.createdAt === "number" ? def.createdAt : 0,
      )
      missions++
    }
  }

  let execs = 0
  const execRoot = path.join(storageDir, "mission_exec")
  for (const projectID of listDirs(execRoot)) {
    const projectDir = path.join(execRoot, projectID)
    for (const missionID of listDirs(projectDir)) {
      for (const file of listJsonFiles(path.join(projectDir, missionID))) {
        const exec = readJson(path.join(projectDir, missionID, file))
        if (!exec?.id || typeof exec.status !== "string") continue
        insertExec.run(
          exec.id,
          exec.missionID ?? missionID,
          projectID,
          exec.status,
          typeof exec.startedAt === "number" ? exec.startedAt : 0,
          typeof exec.endedAt === "number" ? exec.endedAt : null,
          JSON.stringify(exec),
        )
        execs++
      }
    }
  }

  return { missions, execs }
}

function importMonitors(database: BunDatabase, storageDir: string) {
  const insert = database.query(
    `INSERT OR IGNORE INTO monitor
     (id, session_id, status, data, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )

  let monitors = 0
  const root = path.join(storageDir, "monitor")
  for (const sessionID of listDirs(root)) {
    for (const file of listJsonFiles(path.join(root, sessionID))) {
      const record = readJson(path.join(root, sessionID, file))
      if (!record?.id || typeof record.status !== "string") continue
      insert.run(
        record.id,
        record.sessionID ?? sessionID,
        record.status,
        JSON.stringify(record),
        typeof record.time?.created === "number" ? record.time.created : 0,
        typeof record.time?.updated === "number" ? record.time.updated : 0,
      )
      monitors++
    }
  }
  return monitors
}

function importShares(database: BunDatabase, storageDir: string) {
  const insertSession = database.query(`INSERT OR IGNORE INTO session_share (session_id, mode, data) VALUES (?, ?, ?)`)
  const insertLocal = database.query(
    `INSERT OR IGNORE INTO local_share
     (id, session_id, data, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
  )

  let sessionShares = 0
  const sessionRoot = path.join(storageDir, "session_share")
  for (const file of listJsonFiles(sessionRoot)) {
    const share = readJson(path.join(sessionRoot, file))
    if (!share || typeof share.url !== "string") continue
    insertSession.run(path.basename(file, ".json"), share.mode ?? null, JSON.stringify(share))
    sessionShares++
  }

  let localShares = 0
  const localRoot = path.join(storageDir, "local_share")
  for (const file of listJsonFiles(localRoot)) {
    const share = readJson(path.join(localRoot, file))
    if (!share?.id || typeof share.sessionID !== "string") continue
    insertLocal.run(
      share.id,
      share.sessionID,
      JSON.stringify(share),
      typeof share.time?.created === "number" ? share.time.created : 0,
      typeof share.time?.updated === "number" ? share.time.updated : 0,
    )
    localShares++
  }

  return { sessionShares, localShares }
}

function importArtifacts(database: BunDatabase, storageDir: string) {
  const insert = database.query(
    `INSERT OR IGNORE INTO artifact
     (id, session_id, data, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
  )

  let artifacts = 0
  const root = path.join(storageDir, "artifact")
  for (const sessionID of listDirs(root)) {
    for (const file of listJsonFiles(path.join(root, sessionID))) {
      const record = readJson(path.join(root, sessionID, file))
      if (!record?.id || typeof record.secret !== "string") continue
      insert.run(
        record.id,
        record.sessionID ?? sessionID,
        JSON.stringify(record),
        typeof record.time?.created === "number" ? record.time.created : 0,
        typeof record.time?.updated === "number" ? record.time.updated : 0,
      )
      artifacts++
    }
  }
  return artifacts
}

export default {
  id: "20260814020000_domain_sql",
  up(database: BunDatabase) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS mission (
        id          TEXT    NOT NULL PRIMARY KEY,
        project_id  TEXT    NOT NULL,
        name        TEXT    NOT NULL,
        status      TEXT    NOT NULL,
        data        TEXT    NOT NULL,
        created_at  INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_mission_project
        ON mission(project_id, created_at);

      CREATE TABLE IF NOT EXISTS mission_exec (
        id          TEXT    NOT NULL PRIMARY KEY,
        mission_id  TEXT    NOT NULL,
        project_id  TEXT    NOT NULL,
        status      TEXT    NOT NULL,
        started_at  INTEGER NOT NULL,
        ended_at    INTEGER,
        data        TEXT    NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_mission_exec_mission
        ON mission_exec(mission_id, started_at);
      CREATE INDEX IF NOT EXISTS idx_mission_exec_project_status
        ON mission_exec(project_id, status);

      CREATE TABLE IF NOT EXISTS monitor (
        id          TEXT    NOT NULL PRIMARY KEY,
        session_id  TEXT    NOT NULL,
        status      TEXT    NOT NULL,
        data        TEXT    NOT NULL,
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_monitor_session
        ON monitor(session_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_monitor_status
        ON monitor(status);

      CREATE TABLE IF NOT EXISTS session_share (
        session_id  TEXT NOT NULL PRIMARY KEY,
        mode        TEXT,
        data        TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS local_share (
        id          TEXT    NOT NULL PRIMARY KEY,
        session_id  TEXT    NOT NULL,
        data        TEXT    NOT NULL,
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_local_share_session
        ON local_share(session_id);

      CREATE TABLE IF NOT EXISTS artifact (
        id          TEXT    NOT NULL,
        session_id  TEXT    NOT NULL,
        data        TEXT    NOT NULL,
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL,
        PRIMARY KEY (session_id, id)
      );

      CREATE INDEX IF NOT EXISTS idx_artifact_session_updated
        ON artifact(session_id, updated_at);
    `)

    const filename = database.filename
    if (!filename || filename === ":memory:") return
    const storageDir = path.join(path.dirname(filename), "storage")
    if (!fs.existsSync(storageDir)) return

    const missions = importMissions(database, storageDir)
    const monitors = importMonitors(database, storageDir)
    const shares = importShares(database, storageDir)
    const artifacts = importArtifacts(database, storageDir)

    const imported =
      missions.missions + missions.execs + monitors + shares.sessionShares + shares.localShares + artifacts
    if (imported > 0) {
      log.info("imported domain records", { ...missions, monitors, ...shares, artifacts })
    }
  },
} satisfies DatabaseMigration.Migration
