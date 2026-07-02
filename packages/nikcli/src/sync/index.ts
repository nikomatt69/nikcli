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
  aggregate: string
  seq: number
  type: string
  data: unknown
  timestamp: number
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
      aggregate: row.aggregate,
      seq: row.seq,
      type: row.type,
      data: JSON.parse(row.data),
      timestamp: row.timestamp,
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
   * Compacts events when aggregate exceeds MAX_EVENTS_PER_AGGREGATE, or the
   * caller-provided `limit` (kept exactly at `limit` when set — used by the
   * workspace restore journal to honor per-workspace event limits).
   */
  function appendEventWith(db: Executor, projectID: string, event: SyncEventRecord, limit?: number): void {
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

    const threshold = limit ?? MAX_EVENTS_PER_AGGREGATE
    const trimTo = limit ?? COMPACTION_TRIM_TO
    if (countResult && countResult.count > threshold) {
      // Get the oldest events beyond the retention target for this aggregate
      const oldEvents = db
        .select({ id: syncEvent.id })
        .from(syncEvent)
        .where(and(eq(syncEvent.projectId, projectID), eq(syncEvent.aggregate, event.aggregate)))
        .orderBy(asc(syncEvent.seq))
        .limit(countResult.count - trimTo)
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
          after: trimTo,
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
    limit?: number,
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
        appendEventWith(tx, projectID, record, limit)
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
      aggregate: row.aggregate,
      seq: row.seq,
      type: row.type,
      data: JSON.parse(row.data),
      timestamp: row.timestamp,
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

  export async function clearAggregate(projectID: string, aggregate: string): Promise<void> {
    db()
      .delete(syncEvent)
      .where(and(eq(syncEvent.projectId, projectID), eq(syncEvent.aggregate, aggregate)))
      .run()
    db()
      .delete(syncSequence)
      .where(and(eq(syncSequence.projectId, projectID), eq(syncSequence.aggregate, aggregate)))
      .run()
  }
}

/**
 * Unified event journal for instances and workspaces.
 *
 * Single write path for the events that let a client (TUI, mobile, another
 * machine) restore state after a disconnect: local bus mirrors and remote
 * workspace sync loops both append here, so there is exactly one sequenced,
 * replayable backend instead of ad-hoc per-feature event buffers.
 */
export namespace SyncBackend {
  const log = Log.create({ service: "sync.backend" })

  export interface Options {
    /** Keep at most this many events for the aggregate (trims oldest). */
    limit?: number
  }

  export async function append(
    projectID: string,
    aggregate: string,
    event: { type: string; properties?: unknown },
    options?: Options,
  ): Promise<SyncEventRecord> {
    const record = await SyncStorage.reserveSeqAndAppend(
      projectID,
      aggregate,
      (seq) => ({
        id: Identifier.ascending("sync"),
        aggregate,
        seq,
        type: event.type,
        data: event,
        timestamp: Date.now(),
      }),
      options?.limit,
    )
    log.debug("journaled", { projectID, aggregate, type: event.type, seq: record.seq })
    return record
  }

  /** Sequenced records for an aggregate; `fromSeq` allows incremental catch-up. */
  export async function records(projectID: string, aggregate: string, fromSeq?: number): Promise<SyncEventRecord[]> {
    return SyncStorage.getEvents(projectID, aggregate, fromSeq)
  }

  /** Raw event payloads for an aggregate, in append order. */
  export async function payloads(projectID: string, aggregate: string, fromSeq?: number): Promise<unknown[]> {
    return (await records(projectID, aggregate, fromSeq)).map((record) => record.data)
  }

  export async function latest(projectID: string, aggregate: string): Promise<number> {
    return SyncStorage.getLatestSeq(projectID, aggregate)
  }

  export async function clear(projectID: string, aggregate: string): Promise<void> {
    await SyncStorage.clearAggregate(projectID, aggregate)
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
}

type SyncEventDefinition<T extends z.ZodType> = {
  type: string
  schema: T
  version: number
  aggregate: string
}
