import { Database as BunDatabase } from "bun:sqlite"
import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite"
import fs from "fs"
import nodePath from "path"
import { Context, Effect, Layer } from "effect"
import { Global } from "@/global"
import { Log } from "@/util/log"
import { errorMessage } from "@/util/error"
import { DatabaseMigration } from "./migration"
import * as schema from "./schema"

export namespace Database {
  const log = Log.create({ service: "database" })

  export type Schema = typeof schema
  export type Client = BunSQLiteDatabase<Schema>

  export interface Interface {
    readonly db: Client
    readonly native: BunDatabase
    readonly filename: string
  }

  export class Service extends Context.Service<Service, Interface>()("Database.Service") {}

  export function path() {
    const configured = process.env.NIKCLI_DB
    if (configured) {
      if (configured === ":memory:" || nodePath.isAbsolute(configured)) return configured
      return nodePath.join(Global.Path.data, configured)
    }
    return nodePath.join(Global.Path.data, "nikcli.db")
  }

  function open(filename: string): Interface {
    if (filename !== ":memory:") fs.mkdirSync(nodePath.dirname(filename), { recursive: true })

    log.info("opening database", { filename })
    const native = new BunDatabase(filename, { create: true })
    native.exec("PRAGMA journal_mode = WAL")
    native.exec("PRAGMA synchronous = NORMAL")
    native.exec("PRAGMA busy_timeout = 5000")
    native.exec("PRAGMA cache_size = -64000")
    native.exec("PRAGMA foreign_keys = ON")
    // Opencode #22428: disable mmap so the process footprint doesn't grow
    // with the DB file size. Default cache_size (~64MB) bounds the cache
    // anyway, and the latency cost is dwarfed by LLM API round-trips.
    native.exec("PRAGMA mmap_size = 0")
    DatabaseMigration.apply(native)
    native.exec("PRAGMA wal_checkpoint(PASSIVE)")

    return {
      db: drizzle(native, { schema }),
      native,
      filename,
    }
  }

  // ============================================================================
  // Synchronous singleton for domain modules
  // ============================================================================

  let _singleton: Interface | undefined

  function singleton(): Interface {
    // Re-resolve on every access: NIKCLI_TEST_HOME/NIKCLI_DB can change
    // between test files sharing this process, and the previous home may
    // already be deleted. In production the resolved path never changes.
    const filename = path()
    if (_singleton?.filename === filename) return _singleton
    try {
      _singleton?.native.close()
    } catch {}
    _singleton = open(filename)
    // Start the periodic WAL checkpoint loop on first DB open. No-op
    // thereafter if the same filename is reused.
    startWalCheckpointLoop()
    return _singleton
  }

  /** Shared Drizzle client for all domain modules. Safe to call from synchronous code. */
  export function syncDb(): Client {
    return singleton().db
  }

  /** Shared native SQLite client. Useful for admin/debug tooling only. */
  export function syncNative(): BunDatabase {
    return singleton().native
  }

  // ============================================================================
  // Effect service layer
  // ============================================================================

  export function layerFromPath(filename: string) {
    return Layer.effect(
      Service,
      Effect.gen(function* () {
        const service = yield* Effect.sync(() => open(filename))
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            service.native.close()
          }),
        )
        return Service.of(service)
      }),
    )
  }

  export const defaultLayer = Layer.unwrap(Effect.sync(() => layerFromPath(path())))

  // ============================================================================
  // Periodic WAL checkpoint
  // ============================================================================
  // PR counterpart to opencode #22428 (mmap_size=0): PRAGMA wal_checkpoint(TRUNCATE)
  // every 5 minutes prevents the WAL file from growing unbounded. PASSIVE
  // is used on writes (already done at open); TRUNCATE reclaims the WAL file
  // back to size 0. Lock contention is rare because checkpoint is fast on
  // an idle DB.

  const WAL_CHECKPOINT_INTERVAL_MS = 5 * 60 * 1000
  let checkpointTimer: ReturnType<typeof setInterval> | undefined

  export function checkpointWal(native: BunDatabase) {
    return native
      .query<{ busy: number; log: number; checkpointed: number }, []>("PRAGMA wal_checkpoint(TRUNCATE)")
      .get()
  }

  /**
   * Start a background timer that periodically runs `wal_checkpoint(TRUNCATE)`.
   * Safe to call multiple times (no-ops after the first). Stops on SIGINT/SIGTERM
   * and on process exit so it never holds the DB open after shutdown.
   */
  export function startWalCheckpointLoop(): void {
    if (checkpointTimer) return
    if (process.env["NIKCLI_DISABLE_WAL_CHECKPOINT"] === "1") return
    checkpointTimer = setInterval(() => {
      try {
        const native = syncNative()
        const row = checkpointWal(native)
        if (row && row.checkpointed > 0) {
          log.debug("wal checkpoint", row)
        }
      } catch (error) {
        log.warn("wal checkpoint failed", { error: errorMessage(error) })
      }
    }, WAL_CHECKPOINT_INTERVAL_MS)
    checkpointTimer.unref?.()
    const stop = () => {
      if (checkpointTimer) {
        clearInterval(checkpointTimer)
        checkpointTimer = undefined
      }
    }
    process.once("SIGINT", stop)
    process.once("SIGTERM", stop)
    process.once("beforeExit", stop)
  }
}
