import { Database as BunDatabase } from "bun:sqlite"
import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite"
import fs from "fs"
import nodePath from "path"
import { Context, Effect, Layer } from "effect"
import { Global } from "@nikcli-ai/util/global"
import { Log } from "@nikcli-ai/util/log"
import { errorMessage } from "@nikcli-ai/util/error-format"
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

  const singletons = new Map<string, Interface>()

  function singleton(): Interface {
    const filename = path()
    const existing = singletons.get(filename)
    if (existing) return existing
    const service = open(filename)
    singletons.set(filename, service)
    // Start the periodic WAL checkpoint loop on first DB open. No-op
    // thereafter if the same filename is reused.
    startWalCheckpointLoop()
    return service
  }

  /** Shared Drizzle client for all domain modules. Safe to call from synchronous code. */
  export function syncDb(): Client {
    return singleton().db
  }

  /**
   * Shared native SQLite client.
   *
   * Tests, migrations, and admin tooling only — production code must not call
   * this. `test/database/wrapper-inventory.test.ts` asserts it stays absent
   * from `src`. Production SQL the query builder cannot express goes through
   * `rawSql`, which is narrower and says who is asking.
   */
  export function syncNative(): BunDatabase {
    return singleton().native
  }

  /**
   * The native handle narrowed to `query`, for SQL Drizzle's builder cannot
   * express.
   *
   * Analytics is the reason this exists: its aggregates are `json_extract`
   * sums over `message_part.info` grouped by `date(created_at/1000,
   * 'unixepoch')`, which is not a query builder shape, and rewriting them
   * would trade readable SQL for a slower plan on a table that reaches ~600MB.
   *
   * Narrowed rather than handed over whole: a caller gets `query` and not
   * `exec`, `close`, `transaction`, or `serialize`. `purpose` is logged once
   * per distinct value, so who bypasses the builder is visible at runtime
   * rather than only in a grep. `specs/storage/retire-database-wrapper.md`
   * group 2.
   */
  export type RawSql = Pick<BunDatabase, "query">

  const rawPurposes = new Set<string>()

  export function rawSql(purpose: string): RawSql {
    if (!rawPurposes.has(purpose)) {
      rawPurposes.add(purpose)
      log.debug("raw sql consumer", { purpose })
    }
    return singleton().native
  }

  /** Close a synchronous database handle before its backing directory is removed. */
  export function close(filename = path()): boolean {
    const service = singletons.get(filename)
    if (!service) return false
    singletons.delete(filename)
    try {
      service.native.close()
    } catch {}
    return true
  }

  /** Close every synchronous database handle owned by this process. */
  export function closeAll(): void {
    stopWalCheckpointLoop()
    for (const filename of Array.from(singletons.keys())) close(filename)
  }

  /** Test and diagnostics hook for asserting lifecycle cleanup. */
  export function isOpen(filename = path()): boolean {
    return singletons.has(filename)
  }

  // ============================================================================
  // Transactions and post-commit effects
  // ============================================================================

  /** A Drizzle executor: either the root client or a transaction handle. */
  export type Tx = Parameters<Parameters<Client["transaction"]>[0]>[0]
  export type TxOrDb = Client | Tx

  export type TransactionBehavior = "deferred" | "immediate" | "exclusive"

  /**
   * What a transaction body can do besides write.
   *
   * `afterCommit` queues a side effect to run once the outermost transaction
   * has committed — never on rollback, and never while the write lock is
   * still held. Publishing from inside the transaction would let a subscriber
   * observe a state a rollback could still undo.
   *
   * This used to be a module-level queue reached through an ambient
   * `Database.effect(...)`. Handing the registrar to the body instead means a
   * function that defers work says so in its signature, and a caller cannot
   * queue against a transaction it is not in. `specs/storage/retire-database-wrapper.md`
   * group 1.
   */
  export interface TransactionContext {
    afterCommit(fn: () => void): void
  }

  /** The queue shared by an outermost transaction and every nested call inside it. */
  type PostCommitQueue = (() => void)[]

  /**
   * Run `fn` in a transaction, draining post-commit effects afterwards.
   *
   * Nested calls join the outer transaction (SQLite has no real nesting that
   * would help here) and share its queue, so an effect queued in a nested
   * block drains with the outermost commit and a rolled-back inner write can
   * never publish.
   *
   * `behavior` defaults to "immediate": a read-then-write sequence (allocate
   * a sequence number, then append) must take the write lock up front or two
   * processes sharing nikcli.db can both read the same number.
   */
  export function transaction<T>(
    fn: (tx: TxOrDb, ctx: TransactionContext) => T,
    options: { behavior?: TransactionBehavior } = {},
  ): T {
    // Set while an outermost transaction is open, so a nested `transaction`
    // can find the queue to join. Nothing outside this function reads it.
    if (activeQueue) return fn(syncDb() as TxOrDb, contextFor(activeQueue)) as T

    const queue: PostCommitQueue = []
    activeQueue = queue
    try {
      const result = syncDb().transaction((tx) => fn(tx as TxOrDb, contextFor(queue)), {
        behavior: options.behavior ?? "immediate",
      }) as T
      activeQueue = undefined
      for (const effect of queue) {
        try {
          effect()
        } catch (error) {
          log.warn("post-commit effect failed", { error: errorMessage(error) })
        }
      }
      return result
    } catch (error) {
      activeQueue = undefined
      throw error
    }
  }

  let activeQueue: PostCommitQueue | undefined

  function contextFor(queue: PostCommitQueue): TransactionContext {
    return {
      afterCommit(fn) {
        queue.push(fn)
      },
    }
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
    process.once("SIGINT", stopWalCheckpointLoop)
    process.once("SIGTERM", stopWalCheckpointLoop)
    process.once("beforeExit", stopWalCheckpointLoop)
  }

  export function stopWalCheckpointLoop(): void {
    if (!checkpointTimer) return
    clearInterval(checkpointTimer)
    checkpointTimer = undefined
  }
}
