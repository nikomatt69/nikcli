import { Global } from "@/global"
import { Log } from "@/util/log"
import { Identifier } from "@/id/id"
import z from "zod"
import { eq, and, asc, sql } from "drizzle-orm"
import { Database } from "@/database/database"
import { syncEvent, syncSequence } from "./sync.sql"

// Compaction settings
const MAX_EVENTS_PER_AGGREGATE = 1000
const COMPACTION_TRIM_TO = 500

export namespace SyncEvent {
  const log = Log.create({ service: "sync.event" })

  type EventDefinition<T extends z.ZodType> = {
    type: string
    schema: T
    version: number
    aggregate: string
  }

  const registry = new Map<string, EventDefinition<any>>()

  export function define<T extends z.ZodType>(config: {
    type: string
    version?: number
    aggregate: string
    schema: T
  }): EventDefinition<T> {
    const definition = {
      type: config.type,
      schema: config.schema,
      version: config.version ?? 1,
      aggregate: config.aggregate,
    }
    registry.set(config.type, definition)
    log.debug("event registered", {
      type: config.type,
      aggregate: config.aggregate,
    })
    return definition
  }

  export function get(type: string): EventDefinition<any> | undefined {
    return registry.get(type)
  }

  export function types(): string[] {
    return Array.from(registry.keys())
  }
}

// Register workspace event types (used in workspace event loop RESTORE_EVENT_TYPES)
SyncEvent.define({
  type: "session.created",
  aggregate: "session",
  schema: z.object({ id: z.string() }),
})
SyncEvent.define({
  type: "session.updated",
  aggregate: "session",
  schema: z.object({ id: z.string() }),
})
SyncEvent.define({
  type: "session.deleted",
  aggregate: "session",
  schema: z.object({ id: z.string() }),
})
SyncEvent.define({
  type: "session.status",
  aggregate: "session",
  schema: z.object({ sessionID: z.string(), status: z.unknown() }),
})
SyncEvent.define({
  type: "session.idle",
  aggregate: "session",
  schema: z.object({ sessionID: z.string() }),
})
SyncEvent.define({
  type: "permission.asked",
  aggregate: "permission",
  schema: z.object({ id: z.string() }),
})
SyncEvent.define({
  type: "permission.replied",
  aggregate: "permission",
  schema: z.object({ requestID: z.string() }),
})
SyncEvent.define({
  type: "question.asked",
  aggregate: "question",
  schema: z.object({ id: z.string() }),
})
SyncEvent.define({
  type: "question.replied",
  aggregate: "question",
  schema: z.object({ id: z.string() }),
})
SyncEvent.define({
  type: "question.rejected",
  aggregate: "question",
  schema: z.object({ id: z.string() }),
})

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

  export async function emit<T extends z.ZodType>(
    projectID: string,
    eventDef: SyncEventDefinition<T>,
    data: z.infer<T>,
  ): Promise<SyncEventRecord> {
    // Validate event data against the registered schema
    let parsed: z.infer<T>
    try {
      parsed = eventDef.schema.parse(data)
    } catch (err) {
      log.error("event validation failed", {
        projectID,
        type: eventDef.type,
        error: String(err),
      })
      throw new Error(`Event data validation failed for type '${eventDef.type}': ${String(err)}`)
    }

    const aggregate = (parsed as any)[eventDef.aggregate]
    if (!aggregate) {
      throw new Error(`Event data missing aggregate field: ${eventDef.aggregate}`)
    }

    const record = await SyncStorage.reserveSeqAndAppend(projectID, aggregate, (seq) => ({
      id: Identifier.ascending("sync"),
      projectId: projectID,
      aggregate,
      seq,
      type: eventDef.type,
      data: parsed,
      timestamp: Date.now(),
    }))
    log.info("event emitted", {
      projectID,
      type: eventDef.type,
      aggregate,
      seq: record.seq,
    })

    return record
  }

  export async function replay<S>(
    projectID: string,
    aggregate: string,
    initialState: S,
    projectors: SyncProjector<S>[],
  ): Promise<S> {
    const events = await SyncStorage.getEvents(projectID, aggregate)
    let state = initialState

    for (const event of events) {
      const definition = SyncEvent.get(event.type)
      if (!definition) {
        log.warn("unknown event type during replay", {
          projectID,
          type: event.type,
        })
        continue
      }

      for (const projector of projectors) {
        try {
          state = projector(state, event)
        } catch (error) {
          log.error("projector failed during replay", {
            projectID,
            type: event.type,
            error,
          })
        }
      }
    }

    log.info("replay completed", {
      projectID,
      aggregate,
      events: events.length,
    })
    return state
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
   * Convenience wrapper around the snapshot-aware replay. Phase 1 keeps
   * this signature stable; downstream code can switch from
   * `Sync.replay` to `Sync.replayWithSnapshot` without changing the
   * projector chain.
   */
  export async function replayWithSnapshot<S>(
    key: { projectID: string; aggregate: string; aggregateID: string },
    initial: S,
    projectors: SyncProjector<S>[],
  ): Promise<{ state: S; lastSeq: number }> {
    const { SyncReducer } = await import("./reducer")
    return SyncReducer.replayWithSnapshot(key, initial, projectors)
  }
}

type SyncEventDefinition<T extends z.ZodType> = {
  type: string
  schema: T
  version: number
  aggregate: string
}
