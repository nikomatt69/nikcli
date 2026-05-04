import { type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite"
import { migrate } from "drizzle-orm/bun-sqlite/migrator"
export * from "drizzle-orm"
import { lazy } from "@/util/lazy"
import { Global } from "@/global"
import { Log } from "@/util/log"
import path from "path"
import { readFileSync, readdirSync, existsSync } from "fs"
import { init } from "./db.bun"

const log = Log.create({ service: "db" })

type Journal = { sql: string; timestamp: number; name: string }[]

// Drizzle's migrate overloads trigger expensive variance checks here;
// narrow to the journal overload we actually use.
const migrateFromJournal = migrate as unknown as (db: BunSQLiteDatabase, entries: Journal) => void

function time(tag: string): number {
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(tag)
  if (!match) return 0
  return Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6]),
  )
}

function migrations(dir: string): Journal {
  if (!existsSync(dir)) return []
  const dirs = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)

  return dirs
    .map((name) => {
      const file = path.join(dir, name, "migration.sql")
      if (!existsSync(file)) return undefined
      return {
        sql: readFileSync(file, "utf-8"),
        timestamp: time(name),
        name,
      }
    })
    .filter((m): m is Journal[number] => m !== undefined)
    .sort((a, b) => a.timestamp - b.timestamp)
}

/**
 * Open a Drizzle database client for a given database name.
 * Creates the database file in Global.Path.data, sets PRAGMAs, and applies migrations.
 *
 * @param name - The database file name (e.g. "users.db", "accounts.db")
 * @param schema - The Drizzle schema object to pass to the drizzle() constructor
 * @param options - Optional configuration
 * @param options.migrationsDir - Explicit path to migration directory (defaults to auto-detection)
 */
export function open(name: string, schema?: Record<string, unknown>, options?: { migrationsDir?: string }) {
  const dbPath = path.join(Global.Path.data, name)
  log.info("opening database", { path: dbPath })

  const db = init(dbPath)

  // Apply SQLite PRAGMAs for performance and safety
  const client = db.$client as import("bun:sqlite").Database
  client.exec("PRAGMA journal_mode = WAL")
  client.exec("PRAGMA synchronous = NORMAL")
  client.exec("PRAGMA busy_timeout = 5000")
  client.exec("PRAGMA cache_size = -64000")
  client.exec("PRAGMA foreign_keys = ON")

  // Apply migrations if available
  if (options?.migrationsDir) {
    const entries = migrations(options.migrationsDir)
    if (entries.length > 0) {
      log.info("applying migrations", { count: entries.length, db: name })
      migrateFromJournal(db, entries)
    }
  } else {
    // Auto-detect migration directory based on database name
    const baseName = name.replace(".db", "")
    const possibleDirs = [
      path.join(import.meta.dirname, "..", "..", "migration", baseName),
      path.join(import.meta.dirname, "..", "migration", baseName),
    ]

    for (const dir of possibleDirs) {
      if (existsSync(dir)) {
        const entries = migrations(dir)
        if (entries.length > 0) {
          log.info("applying migrations", { count: entries.length, db: name, dir })
          migrateFromJournal(db, entries)
        }
        break
      }
    }
  }

  return db
}

/**
 * Close a database connection.
 */
export function close(db: BunSQLiteDatabase<Record<string, unknown>>) {
  ;(db as any).$client.close()
}

export type DbClient = ReturnType<typeof init>
