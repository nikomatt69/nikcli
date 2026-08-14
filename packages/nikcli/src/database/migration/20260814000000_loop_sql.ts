import { Database as BunDatabase } from "bun:sqlite"
import fs from "fs"
import path from "path"
import { Log } from "@nikcli-ai/util/log"
import type { DatabaseMigration } from "../migration"

const log = Log.create({ service: "database-migration.loop" })

/**
 * Loops move from JSON storage to SQL.
 *
 * Legacy layout (relative to the directory holding the main database file):
 *
 * - `storage/loop/<projectID>/<loopID>.json`               — LoopDefinition
 * - `storage/loop_run/<projectID>/<loopID>/<runID>.json`   — LoopRun
 * - `storage/loop_meta/<projectID>/<loopID>.json`          — { startedRuns }
 *
 * The meta record folds into `loop.started_runs`, which stays nullable so
 * "never counted" is still distinguishable from "counted zero" — that
 * distinction drives the derive-from-history path in `countRuns`.
 *
 * JSON files are left in place as the downgrade fallback, and every insert is
 * `OR IGNORE`, so re-running this against a database whose journal was reset
 * cannot double-import.
 */

function readJson(file: string): any | undefined {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"))
  } catch (error) {
    log.warn("skipping unreadable loop record", { file, error: String(error) })
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
  id: "20260814000000_loop_sql",
  up(database: BunDatabase) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS loop (
        id            TEXT    NOT NULL PRIMARY KEY,
        project_id    TEXT    NOT NULL,
        name          TEXT    NOT NULL,
        enabled       INTEGER NOT NULL,
        paused        INTEGER NOT NULL,
        trigger_kind  TEXT    NOT NULL,
        started_runs  INTEGER,
        data          TEXT    NOT NULL,
        created_at    INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_loop_project
        ON loop(project_id, created_at);

      CREATE TABLE IF NOT EXISTS loop_run (
        id          TEXT    NOT NULL PRIMARY KEY,
        loop_id     TEXT    NOT NULL,
        project_id  TEXT    NOT NULL,
        status      TEXT    NOT NULL,
        started_at  INTEGER NOT NULL,
        ended_at    INTEGER,
        data        TEXT    NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_loop_run_loop
        ON loop_run(loop_id, started_at);
      CREATE INDEX IF NOT EXISTS idx_loop_run_project_status
        ON loop_run(project_id, status);
    `)

    const filename = database.filename
    if (!filename || filename === ":memory:") return
    const storageDir = path.join(path.dirname(filename), "storage")
    if (!fs.existsSync(storageDir)) return

    const insertLoop = database.query(
      `INSERT OR IGNORE INTO loop
       (id, project_id, name, enabled, paused, trigger_kind, started_runs, data, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    const insertRun = database.query(
      `INSERT OR IGNORE INTO loop_run
       (id, loop_id, project_id, status, started_at, ended_at, data)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )

    // Counters first: a definition carries its counter in the same row.
    const counters = new Map<string, number>()
    const metaRoot = path.join(storageDir, "loop_meta")
    for (const projectID of listDirs(metaRoot)) {
      for (const file of listJsonFiles(path.join(metaRoot, projectID))) {
        const meta = readJson(path.join(metaRoot, projectID, file))
        const startedRuns = meta?.startedRuns
        if (typeof startedRuns !== "number" || !Number.isFinite(startedRuns)) continue
        counters.set(`${projectID}/${path.basename(file, ".json")}`, Math.max(0, Math.trunc(startedRuns)))
      }
    }

    let loops = 0
    const loopRoot = path.join(storageDir, "loop")
    for (const projectID of listDirs(loopRoot)) {
      for (const file of listJsonFiles(path.join(loopRoot, projectID))) {
        const def = readJson(path.join(loopRoot, projectID, file))
        if (!def?.id || typeof def.name !== "string") continue
        insertLoop.run(
          def.id,
          projectID,
          def.name,
          def.enabled ? 1 : 0,
          def.paused ? 1 : 0,
          def.trigger?.kind ?? "manual",
          counters.get(`${projectID}/${def.id}`) ?? null,
          JSON.stringify(def),
          typeof def.createdAt === "number" ? def.createdAt : 0,
        )
        loops++
      }
    }

    let runs = 0
    const runRoot = path.join(storageDir, "loop_run")
    for (const projectID of listDirs(runRoot)) {
      const projectDir = path.join(runRoot, projectID)
      for (const loopID of listDirs(projectDir)) {
        for (const file of listJsonFiles(path.join(projectDir, loopID))) {
          const run = readJson(path.join(projectDir, loopID, file))
          if (!run?.id || typeof run.status !== "string") continue
          insertRun.run(
            run.id,
            run.loopID ?? loopID,
            projectID,
            run.status,
            typeof run.startedAt === "number" ? run.startedAt : 0,
            typeof run.endedAt === "number" ? run.endedAt : null,
            JSON.stringify(run),
          )
          runs++
        }
      }
    }

    if (loops + runs > 0) log.info("imported loop records", { loops, runs, counters: counters.size })
  },
} satisfies DatabaseMigration.Migration
