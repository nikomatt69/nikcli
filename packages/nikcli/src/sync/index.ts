import { Global } from "@/global"
import path from "path"
import { Log } from "@/util/log"
import { lazy } from "@/util/lazy"
import { Identifier } from "@/id/id"
import z from "zod"

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
    return definition
  }

  export function get(type: string): EventDefinition<any> | undefined {
    return registry.get(type)
  }

  export function types(): string[] {
    return Array.from(registry.keys())
  }
}

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

  const storage = lazy(async () => {
    const dir = path.join(Global.Path.data, "sync")
    await Bun.write(dir, "")
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

  export async function saveEvents(projectID: string, events: SyncEventRecord[]): Promise<void> {
    const file = await eventsFile(projectID)
    await Bun.write(file, JSON.stringify(events, null, 2))
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
    await Bun.write(file, JSON.stringify(sequence, null, 2))
  }

  export async function appendEvent(projectID: string, event: SyncEventRecord): Promise<void> {
    const events = await loadEvents(projectID)
    events.push(event)
    await saveEvents(projectID, events)

    const sequence = await loadSequence(projectID)
    sequence[event.aggregate] = event.seq
    await saveSequence(projectID, sequence)

    log.debug("event appended", { projectID, type: event.type, aggregate: event.aggregate, seq: event.seq })
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
      .catch(() => { })
    await Bun.file(seqF)
      .delete()
      .catch(() => { })
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
    const aggregate = (data as any)[eventDef.aggregate]
    if (!aggregate) {
      throw new Error(`Event data missing aggregate field: ${eventDef.aggregate}`)
    }

    const seq = (await SyncStorage.getLatestSeq(projectID, aggregate)) + 1
    const record: SyncEventRecord = {
      id: Identifier.ascending("sync"),
      aggregate,
      seq,
      type: eventDef.type,
      data,
      timestamp: Date.now(),
    }

    await SyncStorage.appendEvent(projectID, record)
    log.info("event emitted", { projectID, type: eventDef.type, aggregate, seq })

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
  version: number
  aggregate: string
}
