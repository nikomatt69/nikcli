import { Log } from "@/util/log"
import { Identifier } from "@/id/id"
import { eq, and, asc, sql } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import { Database } from "@/database/database"
import { syncEvent, syncSequence } from "./sync.sql"

// Compaction settings
const MAX_EVENTS_PER_AGGREGATE = 1000
const COMPACTION_TRIM_TO = 500

export interface SyncEventRecord {
  id: string
  projectId: string
  workspaceId?: string
  aggregate: string
  seq: number
  type: string
  data: unknown
  timestamp: number
  origin?: string
  originSeq?: number
}

export interface SyncSequence {
  [aggregate: string]: number
}

export namespace SyncStorage {
  const log = Log.create({ service: "sync.storage" })

  function db() {
    return Database.syncDb()
  }

  export async function loadEvents(projectID: string): Promise<SyncEventRecord[]> {
    const rows = db()
      .select()
      .from(syncEvent)
      .where(eq(syncEvent.projectId, projectID))
      .orderBy(asc(syncEvent.seq))
      .all()
    return rows.map((row) => ({
      id: row.id,
      projectId: row.projectId,
      workspaceId: row.workspaceId ?? undefined,
      aggregate: row.aggregate,
      seq: row.seq,
      type: row.type,
      data: JSON.parse(row.data),
      timestamp: row.timestamp,
      origin: row.origin,
      originSeq: row.originSeq ?? undefined,
    }))
  }

  export async function saveEvents(projectID: string, events: SyncEventRecord[]): Promise<void> {
    // Delete existing events for this project and re-insert atomically
    db().transaction(
      (tx) => {
        tx.delete(syncEvent).where(eq(syncEvent.projectId, projectID)).run()
        for (const event of events) {
          tx.insert(syncEvent)
            .values({
              id: event.id,
              projectId: projectID,
              aggregate: event.aggregate,
              seq: event.seq,
              type: event.type,
              data: JSON.stringify(event.data),
              timestamp: event.timestamp,
            })
            .run()
        }
      },
      { behavior: "immediate" },
    )
  }

  export async function loadSequence(projectID: string): Promise<SyncSequence> {
    const rows = db().select().from(syncSequence).where(eq(syncSequence.projectId, projectID)).all()
    const seq: SyncSequence = {}
    for (const row of rows) {
      seq[row.aggregate] = row.seq
    }
    return seq
  }

  export async function saveSequence(projectID: string, sequence: SyncSequence): Promise<void> {
    for (const [aggregate, seq] of Object.entries(sequence)) {
      db()
        .insert(syncSequence)
        .values({ projectId: projectID, aggregate, seq })
        .onConflictDoUpdate({
          target: [syncSequence.projectId, syncSequence.aggregate],
          set: { seq },
        })
        .run()
    }
  }

  /** Query surface shared by the root client and transaction clients. */
  type Executor = Pick<Database.Client, "select" | "insert" | "delete">

  /**
   * Append event with compaction.
   * Compacts events when aggregate exceeds MAX_EVENTS_PER_AGGREGATE.
   */
  function appendEventWith(db: Executor, projectID: string, event: SyncEventRecord): void {
    // Insert the event
    db.insert(syncEvent)
      .values({
        id: event.id,
        projectId: projectID,
        aggregate: event.aggregate,
        seq: event.seq,
        type: event.type,
        data: JSON.stringify(event.data),
        timestamp: event.timestamp,
      })
      .run()

    // Compaction: count events for this aggregate
    const countResult = db
      .select({ count: sql<number>`cast(count(*) as integer)` })
      .from(syncEvent)
      .where(and(eq(syncEvent.projectId, projectID), eq(syncEvent.aggregate, event.aggregate)))
      .get()

    if (countResult && countResult.count > MAX_EVENTS_PER_AGGREGATE) {
      // Get the oldest COMPACTION_TRIM_TO events for this aggregate
      const oldEvents = db
        .select({ id: syncEvent.id })
        .from(syncEvent)
        .where(and(eq(syncEvent.projectId, projectID), eq(syncEvent.aggregate, event.aggregate)))
        .orderBy(asc(syncEvent.seq))
        .limit(countResult.count - COMPACTION_TRIM_TO)
        .all()

      if (oldEvents.length > 0) {
        const ids = oldEvents.map((e) => e.id)
        // Delete old events using a subquery approach
        for (const id of ids) {
          db.delete(syncEvent).where(eq(syncEvent.id, id)).run()
        }
        log.debug("compaction applied", {
          projectID,
          aggregate: event.aggregate,
          before: countResult.count,
          after: COMPACTION_TRIM_TO,
        })
      }
    }

    // Update sequence
    db.insert(syncSequence)
      .values({
        projectId: projectID,
        aggregate: event.aggregate,
        seq: event.seq,
      })
      .onConflictDoUpdate({
        target: [syncSequence.projectId, syncSequence.aggregate],
        set: { seq: event.seq },
      })
      .run()

    log.debug("event appended", {
      projectID,
      type: event.type,
      aggregate: event.aggregate,
      seq: event.seq,
    })
  }

  export async function appendEvent(projectID: string, event: SyncEventRecord): Promise<void> {
    db().transaction((tx) => appendEventWith(tx, projectID, event), {
      behavior: "immediate",
    })
  }

  export async function reserveSeqAndAppend(
    projectID: string,
    aggregate: string,
    create: (seq: number) => SyncEventRecord,
  ): Promise<SyncEventRecord> {
    // BEGIN IMMEDIATE so sequence read + append are atomic even across
    // multiple processes sharing nikcli.db.
    return db().transaction(
      (tx) => {
        const seqRow = tx
          .select({ seq: syncSequence.seq })
          .from(syncSequence)
          .where(and(eq(syncSequence.projectId, projectID), eq(syncSequence.aggregate, aggregate)))
          .get()
        const seq = (seqRow?.seq ?? 0) + 1
        const record = create(seq)
        appendEventWith(tx, projectID, record)
        return record
      },
      { behavior: "immediate" },
    )
  }

  export async function getEvents(projectID: string, aggregate: string, fromSeq?: number): Promise<SyncEventRecord[]> {
    const conditions = [eq(syncEvent.projectId, projectID), eq(syncEvent.aggregate, aggregate)]
    if (fromSeq !== undefined) {
      conditions.push(sql`${syncEvent.seq} > ${fromSeq}`)
    }
    const rows = db()
      .select()
      .from(syncEvent)
      .where(and(...conditions))
      .orderBy(asc(syncEvent.seq))
      .all()
    return rows.map((row) => ({
      id: row.id,
      projectId: row.projectId,
      workspaceId: row.workspaceId ?? undefined,
      aggregate: row.aggregate,
      seq: row.seq,
      type: row.type,
      data: JSON.parse(row.data),
      timestamp: row.timestamp,
      origin: row.origin,
      originSeq: row.originSeq ?? undefined,
    }))
  }

  export async function getLatestSeq(projectID: string, aggregate: string): Promise<number> {
    const row = db()
      .select({ seq: syncSequence.seq })
      .from(syncSequence)
      .where(and(eq(syncSequence.projectId, projectID), eq(syncSequence.aggregate, aggregate)))
      .get()
    return row?.seq ?? 0
  }

  export async function clear(projectID: string): Promise<void> {
    db().delete(syncEvent).where(eq(syncEvent.projectId, projectID)).run()
    db().delete(syncSequence).where(eq(syncSequence.projectId, projectID)).run()
  }

  /**
   * Stamp denormalized metadata (workspace_id, origin, origin_seq) on a
   * freshly-appended event. The append is the authoritative part; the
   * metadata is denormalized for query convenience and does not affect
   * sequencing or replay.
   */
  export function stampMetadata(
    eventID: string,
    metadata: { workspaceID?: string; origin?: string; originSeq?: number },
  ): void {
    const updates: Record<string, unknown> = {}
    if (metadata.workspaceID !== undefined) updates.workspaceId = metadata.workspaceID
    if (metadata.origin !== undefined) updates.origin = metadata.origin
    if (metadata.originSeq !== undefined) updates.originSeq = metadata.originSeq
    if (Object.keys(updates).length === 0) return
    db().update(syncEvent).set(updates).where(eq(syncEvent.id, eventID)).run()
  }

  /**
   * Read every event for a single aggregate across all projects, in
   * sequence order. The aggregate id is globally unique (workspace id,
   * session id, permission id, …) so we can address it without a
   * project scope. Returned shape is the JSON-decoded `data` field,
   * suitable for cold-start projection.
   */
  export async function readAggregate(aggregate: string): Promise<unknown[]> {
    const rows = db()
      .select({ data: syncEvent.data, seq: syncEvent.seq })
      .from(syncEvent)
      .where(eq(syncEvent.aggregate, aggregate))
      .orderBy(asc(syncEvent.seq))
      .all()
    return rows.map((row) => {
      try {
        return JSON.parse(row.data)
      } catch {
        return null
      }
    })
  }
}

export interface SyncProjector<S> {
  (state: S, event: SyncEventRecord): S
}

export namespace Sync {
  const log = Log.create({ service: "sync" })

  /**
   * Post-emit hook: listeners run after an event row lands in
   * `sync_event`, with the resolved origin ("local" unless the caller
   * tagged the event as remote). The remote sync outbox subscribes here
   * to enqueue local events for push. Returns an unsubscribe function.
   */
  export type EmitListener = (record: SyncEventRecord, meta: { origin: string }) => void
  const emitListeners = new Set<EmitListener>()
  export function onEmit(listener: EmitListener): () => void {
    emitListeners.add(listener)
    return () => {
      emitListeners.delete(listener)
    }
  }

  /**
   * Fan an already-appended event out to the emit listeners.
   *
   * `SyncEvent` (sync-event.ts) writes its own rows transactionally with the
   * projector, so it cannot go through `emitRaw` — but its events still have
   * to reach the outbox. This is that entry point.
   */
  export function notify(record: SyncEventRecord, meta: { origin: string }) {
    notifyEmitListeners(record, meta)
  }

  function notifyEmitListeners(record: SyncEventRecord, meta: { origin: string }) {
    for (const listener of emitListeners) {
      try {
        listener(record, meta)
      } catch (error) {
        log.warn("emit listener failed", { type: record.type, error })
      }
    }
  }

  export async function getEvents(projectID: string, aggregate: string, fromSeq?: number): Promise<SyncEventRecord[]> {
    return SyncStorage.getEvents(projectID, aggregate, fromSeq)
  }

  export async function getLatestSeq(projectID: string, aggregate: string): Promise<number> {
    return SyncStorage.getLatestSeq(projectID, aggregate)
  }

  export async function clear(projectID: string): Promise<void> {
    await SyncStorage.clear(projectID)
    log.info("sync data cleared", { projectID })
  }

  /**
   * Emit a raw, schema-less event. Used by domain bridges (workspace,
   * session, permission) that want to push an event without registering
   * a zod schema up front. The `aggregate` is the workspace/session/etc.
   * id; the caller is responsible for keeping the `data` shape stable.
   *
   * The `workspaceID` and `origin` fields are optional and propagated
   * to the row for routing and conflict resolution. `originSeq` is set
   * by the server when it renumbers an event received from a remote
   * origin; for locally-emitted events it stays null.
   */
  export async function emitRaw(
    projectID: string,
    aggregate: string,
    data: unknown,
    options: { workspaceID?: string; origin?: string; originSeq?: number } = {},
  ): Promise<SyncEventRecord> {
    if (!aggregate) throw new Error("emitRaw requires a non-empty aggregate")
    const record = await SyncStorage.reserveSeqAndAppend(projectID, aggregate, (seq) => ({
      id: Identifier.ascending("sync"),
      projectId: projectID,
      aggregate,
      seq,
      type: typeof (data as any)?.type === "string" ? ((data as any).type as string) : "raw",
      data,
      timestamp: Date.now(),
    }))
    // Stamp workspace_id / origin / origin_seq post-insert via a follow-up
    // UPDATE. The append is the authoritative part; the metadata is
    // denormalized for queries and does not affect sequencing.
    if (options.workspaceID || options.origin || options.originSeq !== undefined) {
      SyncStorage.stampMetadata(record.id, {
        workspaceID: options.workspaceID,
        origin: options.origin ?? "local",
        originSeq: options.originSeq,
      })
    }
    log.info("raw event emitted", {
      projectID,
      aggregate,
      seq: record.seq,
      origin: options.origin ?? "local",
    })
    notifyEmitListeners(record, { origin: options.origin ?? "local" })
    return record
  }

  /**
   * Read every event for a single aggregate across all projects, in
   * sequence order. Used by cold-start replay for an aggregate whose
   * projectID is not yet known (e.g. a workspace id is globally
   * unique, so the projector can address it without a project scope).
   */
  export async function readAggregate(aggregate: string): Promise<unknown[]> {
    return SyncStorage.readAggregate(aggregate)
  }

  /**
   * Convenience wrapper around the snapshot-aware replay so callers can
   * stay on the `Sync` surface without importing the reducer directly.
   */
  export async function replayWithSnapshot<S>(
    key: { projectID: string; aggregate: string; aggregateID: string },
    initial: S,
    projectors: SyncProjector<S>[],
  ): Promise<{ state: S; lastSeq: number }> {
    const { SyncReducer } = await import("./reducer")
    return SyncReducer.replayWithSnapshot(key, initial, projectors)
  }

  /**
   * Effect service surface for the sync module. The free-function
   * namespace above remains the source of truth for the actual work;
   * the service is a thin, Effect-friendly wrapper so the HttpApi
   * bridge and the workspace reducer can participate in Effect's
   * resource model.
   *
   * Methods are 1:1 with the underlying sync surface:
   *  - `start`  → kick the hub connection, idempotent (mirrors `SyncCliInit.startForAllProjects`)
   *  - `push`   → write to local outbox + emit on `GlobalBus("event")`
   *  - `outbox` → paginated GET (mirrors `GET /sync/outbox` in `routes/sync.ts`)
   *  - `snapshot` → cold-start projection (mirrors `SyncProjection.byAggregate`)
   *  - `state`  → configured/url/pending/failed stats (mirrors `GET /sync/stats` in `routes/sync.ts`)
   *
   * All methods return `Effect<…, never, never>` (no service dependency)
   * because they are plain async wrappers over the free functions and
   * the database. Errors during a `push` are intentionally swallowed to
   * the error channel of the underlying function so the bridge can
   * surface them with the declared schema.
   */
  export interface Interface {
    readonly start: (opts: {
      url: string
      token: string
      projectID: string
    }) => Effect.Effect<{ started: boolean; error?: string }, never>
    readonly push: (
      projectID: string,
      input: { aggregate: string; data: unknown; origin?: string },
    ) => Effect.Effect<void, never>
    readonly outbox: (
      projectID: string,
      aggregate: string,
      since: number,
      limit?: number,
    ) => Effect.Effect<{ events: SyncEventRecord[]; hasMore: boolean }, never>
    readonly snapshot: (
      aggregate: string,
      projectID: string,
    ) => Effect.Effect<{ lastSeq: number; state: unknown } | null, never>
    readonly state: () => Effect.Effect<
      {
        configured: boolean
        url?: string
        pending: number
        failed: number
        lastSeq?: number
      },
      never
    >
  }

  export class Service extends Context.Service<Service, Interface>()("@nikcli/Sync") {}

  /**
   * Default layer for `Sync.Service`. All methods are async wrappers over
   * the existing free functions, so the layer carries no dependencies of
   * its own. The `Database.syncDb()` handle inside the free functions
   * resolves its own globals.
   */
  export const layer: Layer.Layer<Service> = Layer.succeed(
    Service,
    Service.of({
      start: (opts) =>
        Effect.promise(async () => {
          try {
            const { SyncCliInit } = await import("./cli-init")
            const result = await SyncCliInit.startForAllProjects({
              url: opts.url,
              token: opts.token,
            })
            return { started: result.count > 0 }
          } catch (err) {
            return {
              started: false,
              error: err instanceof Error ? err.message : String(err),
            }
          }
        }),
      push: (projectID, input) =>
        Effect.promise(async () => {
          await emitRaw(projectID, input.aggregate, input.data, {
            origin: input.origin,
          })
        }),
      outbox: (projectID, aggregate, since, limit = 100) =>
        Effect.promise(async () => {
          const events = await getEvents(projectID, aggregate, since)
          const trimmed = events.slice(0, limit)
          return {
            events: trimmed,
            hasMore: events.length > limit,
          }
        }),
      snapshot: (aggregate, projectID) =>
        Effect.promise(async () => {
          const { SyncProjection } = await import("./projection")
          const result = await SyncProjection.byAggregate(projectID, aggregate)
          return result ?? null
        }),
      state: () =>
        Effect.promise(async () => {
          const { SyncConfig } = await import("./sync-config")
          const { Database } = await import("../database/database")
          const { eq, sql } = await import("drizzle-orm")
          const { syncOutbox, syncEvent } = await import("./sync.sql")
          const resolved = await SyncConfig.resolve()
          const db = Database.syncDb()
          const pending =
            db
              .select({ count: sql<number>`cast(count(*) as integer)` })
              .from(syncOutbox)
              .where(eq(syncOutbox.status, "pending"))
              .get()?.count ?? 0
          const failed =
            db
              .select({ count: sql<number>`cast(count(*) as integer)` })
              .from(syncOutbox)
              .where(eq(syncOutbox.status, "failed"))
              .get()?.count ?? 0
          const latest = db
            .select({ seq: syncEvent.seq })
            .from(syncEvent)
            .orderBy(sql`${syncEvent.seq} DESC`)
            .limit(1)
            .get()
          return {
            configured: resolved.configured,
            url: resolved.url,
            pending,
            failed,
            lastSeq: latest?.seq,
          }
        }),
    }),
  )

  export const defaultLayer = layer
}
