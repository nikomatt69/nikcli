import { Global } from "@/global"
import path from "path"
import fs from "fs/promises"
import { Log } from "@/util/log"
import { lazy, lazyAsync } from "@/util/lazy"
import { Identifier } from "@/id/id"
import z from "zod"
import { Lock } from "@/util/lock"
import { Schema } from "effect"
import { zod as zodFromSchema, zodObjectMode } from "@/util/effect-zod"

// Compaction settings
const MAX_EVENTS_PER_AGGREGATE = 1000
const COMPACTION_TRIM_TO = 500

function isEffectSchema(input: z.ZodType | Schema.Schema<any, any, any>): input is Schema.Schema<any, any, any> {
  return "ast" in input
}

export namespace SyncEvent {
  const log = Log.create({ service: "sync.event" })

  type EventDefinition<T extends z.ZodType> = {
    type: string
    schema: T
    effectSchema?: Schema.Schema<any, any, any>
    version: number
    aggregate: string
  }

  const registry = new Map<string, EventDefinition<any>>()

  export function define<T extends z.ZodType>(config: {
    type: string
    version?: number
    aggregate: string
    schema: T
  }): EventDefinition<T>
  export function define<S extends Schema.Schema<any, any, any>>(config: {
    type: string
    version?: number
    aggregate: string
    schema: S
  }): EventDefinition<z.ZodType<Schema.Schema.Type<S>>>
  export function define(config: {
    type: string
    version?: number
    aggregate: string
    schema: z.ZodType | Schema.Schema<any, any, any>
  }): EventDefinition<z.ZodType> {
    let schema: z.ZodType
    let effectSchema: Schema.Schema<any, any, any> | undefined
    if (isEffectSchema(config.schema)) {
      effectSchema = config.schema
      schema = zodFromSchema(config.schema as Schema.Schema<any, any, never>)
    } else {
      schema = config.schema
    }
    const definition: EventDefinition<z.ZodType> = {
      type: config.type,
      schema,
      version: config.version ?? 1,
      aggregate: config.aggregate,
    }
    if (effectSchema) definition.effectSchema = effectSchema
    registry.set(config.type, definition)
    log.debug("event registered", { type: config.type, aggregate: config.aggregate })
    return definition
  }

  export function get(type: string): EventDefinition<any> | undefined {
    return registry.get(type)
  }

  export function types(): string[] {
    return Array.from(registry.keys())
  }
}

const syncEventStrip = zodObjectMode("strip")

// Register workspace event types (used in workspace event loop RESTORE_EVENT_TYPES)
SyncEvent.define({
  type: "session.created",
  aggregate: "session",
  schema: Schema.Struct({ id: Schema.String }).annotations(syncEventStrip),
})
SyncEvent.define({
  type: "session.updated",
  aggregate: "session",
  schema: Schema.Struct({ id: Schema.String }).annotations(syncEventStrip),
})
SyncEvent.define({
  type: "session.deleted",
  aggregate: "session",
  schema: Schema.Struct({ id: Schema.String }).annotations(syncEventStrip),
})
SyncEvent.define({
  type: "session.status",
  aggregate: "session",
  schema: Schema.Struct({ sessionID: Schema.String, status: Schema.Unknown }).annotations(syncEventStrip),
})
SyncEvent.define({
  type: "session.idle",
  aggregate: "session",
  schema: Schema.Struct({ sessionID: Schema.String }).annotations(syncEventStrip),
})
SyncEvent.define({
  type: "permission.asked",
  aggregate: "permission",
  schema: Schema.Struct({ id: Schema.String }).annotations(syncEventStrip),
})
SyncEvent.define({
  type: "permission.replied",
  aggregate: "permission",
  schema: Schema.Struct({ requestID: Schema.String }).annotations(syncEventStrip),
})
SyncEvent.define({
  type: "question.asked",
  aggregate: "question",
  schema: Schema.Struct({ id: Schema.String }).annotations(syncEventStrip),
})
SyncEvent.define({
  type: "question.replied",
  aggregate: "question",
  schema: Schema.Struct({ id: Schema.String }).annotations(syncEventStrip),
})
SyncEvent.define({
  type: "question.rejected",
  aggregate: "question",
  schema: Schema.Struct({ id: Schema.String }).annotations(syncEventStrip),
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

  const storage = lazyAsync(async () => {
    const dir = path.join(Global.Path.data, "sync")
    await fs.mkdir(dir, { recursive: true })
    return { dir }
  })

  async function eventsFile(projectID: string): Promise<string> {
    const { dir } = await storage()
    return path.join(dir, `${projectID}.events.json`)
  }

  async function sequenceFile(projectID: string): Promise<string> {
    const { dir } = await storage()
    return path.join(dir, `${projectID}.sequence.json`)
  }

  export async function loadEvents(projectID: string): Promise<SyncEventRecord[]> {
    try {
      const file = await eventsFile(projectID)
      return await Bun.file(file).json()
    } catch {
      return []
    }
  }

  /**
   * Atomic write: write to temp file then rename to target.
   * This ensures filesystem-level atomicity on rename.
   */
  async function atomicWrite(filePath: string, data: string): Promise<void> {
    const tmp = filePath + `.tmp.${Date.now()}.${Math.random().toString(36).slice(2)}`
    await Bun.write(tmp, data)
    await fs.rename(tmp, filePath)
  }

  export async function saveEvents(projectID: string, events: SyncEventRecord[]): Promise<void> {
    const file = await eventsFile(projectID)
    await atomicWrite(file, JSON.stringify(events, null, 2))
  }

  export async function loadSequence(projectID: string): Promise<SyncSequence> {
    try {
      const file = await sequenceFile(projectID)
      return await Bun.file(file).json()
    } catch {
      return {}
    }
  }

  export async function saveSequence(projectID: string, sequence: SyncSequence): Promise<void> {
    const file = await sequenceFile(projectID)
    await atomicWrite(file, JSON.stringify(sequence, null, 2))
  }

  /**
   * Append event with compaction and atomic write.
   * Compacts events when aggregate exceeds MAX_EVENTS_PER_AGGREGATE.
   */
  async function appendEventUnlocked(projectID: string, event: SyncEventRecord): Promise<void> {
    let events = await loadEvents(projectID)
    events.push(event)

    // Compaction: if we have too many events for this aggregate, trim old ones
    const aggregateEvents = events.filter((e) => e.aggregate === event.aggregate)
    if (aggregateEvents.length > MAX_EVENTS_PER_AGGREGATE) {
      const others = events.filter((e) => e.aggregate !== event.aggregate)
      const toTrim = aggregateEvents.slice(-COMPACTION_TRIM_TO)
      events = [...others, ...toTrim]
      log.debug("compaction applied", {
        projectID,
        aggregate: event.aggregate,
        before: aggregateEvents.length,
        after: toTrim.length,
      })
    }

    await saveEvents(projectID, events)

    const sequence = await loadSequence(projectID)
    sequence[event.aggregate] = event.seq
    await saveSequence(projectID, sequence)

    log.debug("event appended", { projectID, type: event.type, aggregate: event.aggregate, seq: event.seq })
  }

  export async function appendEvent(projectID: string, event: SyncEventRecord): Promise<void> {
    using _ = await Lock.write(`sync-storage:${projectID}`)
    await appendEventUnlocked(projectID, event)
  }

  export async function reserveSeqAndAppend(
    projectID: string,
    aggregate: string,
    create: (seq: number) => SyncEventRecord,
  ): Promise<SyncEventRecord> {
    using _ = await Lock.write(`sync-storage:${projectID}`)
    const seq = (await getLatestSeq(projectID, aggregate)) + 1
    const record = create(seq)
    await appendEventUnlocked(projectID, record)
    return record
  }

  export async function getEvents(projectID: string, aggregate: string, fromSeq?: number): Promise<SyncEventRecord[]> {
    const events = await loadEvents(projectID)
    return events
      .filter((e) => e.aggregate === aggregate)
      .filter((e) => fromSeq === undefined || e.seq > fromSeq)
      .sort((a, b) => a.seq - b.seq)
  }

  export async function getLatestSeq(projectID: string, aggregate: string): Promise<number> {
    const sequence = await loadSequence(projectID)
    return sequence[aggregate] ?? 0
  }

  export async function clear(projectID: string): Promise<void> {
    const { dir } = await storage()
    const eventsF = path.join(dir, `${projectID}.events.json`)
    const seqF = path.join(dir, `${projectID}.sequence.json`)
    await Bun.file(eventsF)
      .delete()
      .catch(() => {})
    await Bun.file(seqF)
      .delete()
      .catch(() => {})
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
      log.error("event validation failed", { projectID, type: eventDef.type, error: String(err) })
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
    log.info("event emitted", { projectID, type: eventDef.type, aggregate, seq: record.seq })

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
        log.warn("unknown event type during replay", { projectID, type: event.type })
        continue
      }

      for (const projector of projectors) {
        try {
          state = projector(state, event)
        } catch (error) {
          log.error("projector failed during replay", { projectID, type: event.type, error })
        }
      }
    }

    log.info("replay completed", { projectID, aggregate, events: events.length })
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
  effectSchema?: Schema.Schema<any, any, any>
  version: number
  aggregate: string
}
