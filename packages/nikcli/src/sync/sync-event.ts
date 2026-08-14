import z from "zod"
import type { ZodObject } from "zod"
import { and, asc, eq } from "drizzle-orm"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { Database } from "@/database/database"
import { Identifier } from "@nikcli-ai/util/id"
import { Instance } from "@/project/instance"
import { Log } from "@nikcli-ai/util/log"
import { syncEvent, syncSequence } from "./sync.sql"
import { Sync, type SyncEventRecord } from "./index"

/**
 * SyncEvent — event sourcing on the write path.
 *
 * Ported from opencode 2.0's `src/sync/`, with one deliberate difference:
 * it writes into nikcli's existing `sync_event` / `sync_sequence` tables
 * rather than introducing a second pair. nikcli already had an event log
 * (for remote/multi-device sync); making the domain write path emit into the
 * same log means every session mutation becomes syncable for free instead of
 * splitting the repo across two systems both called "sync".
 *
 * The inversion this brings:
 *
 *     before   mutate the row, then publish a bus event describing it
 *     after    run the event, whose projector performs the mutation inside
 *              the same transaction that allocated its sequence number
 *
 * The event is the source of truth and the row is a projection of it, so an
 * ordered replay reconstructs state by construction. Sequence numbers are
 * totally ordered per aggregate under a single writer, which is all the
 * ordering a one-writer/many-readers sync needs.
 *
 * Backwards compatibility is the same trick opencode uses: sync events
 * re-publish on the existing `Bus` after commit, so every current
 * `Bus.subscribe` call site keeps working untouched. `busSchema` carries the
 * legacy payload shape for the type checker when the stored event shape and
 * the published shape differ (e.g. a partial update vs. the full object);
 * `convertEvent` performs the matching runtime reshape.
 */
export namespace SyncEvent {
  const log = Log.create({ service: "sync-event" })

  export type Definition = {
    type: string
    version: number
    aggregate: string
    schema: ZodObject
    /** The shape the event takes on the Bus. Equals `schema` unless a
     *  `busSchema` was supplied for backwards compatibility. */
    properties: ZodObject
    /**
     * Bus definition to publish through. nikcli registers its events with
     * `BusEvent.schema` (Effect Schema), and `BusEvent.schemas()` throws if
     * any registered event lacks one — so a sync event over an existing bus
     * event must reuse that registration rather than re-`define` it as
     * zod-only.
     *
     * Supplied as a thunk: the definitions live next to the domain code that
     * publishes them, which imports this module back, and resolving at
     * define time would read the not-yet-initialized half of that cycle.
     */
    bus?: () => BusEvent.Definition
    /**
     * Whether the event is written to the durable log.
     *
     * `message.part.updated` fires once per token; logging it would be one
     * row per delta — the per-token disk write problem. Its projection (the
     * part row) is an upsert and already carries the latest state, so the
     * event is projected and published but not logged, and does not consume
     * a sequence number.
     */
    log: boolean
  }

  export type Event<Def extends Definition = Definition> = {
    id: string
    seq: number
    aggregateID: string
    projectID: string
    data: z.infer<Def["schema"]>
  }

  export type SerializedEvent<Def extends Definition = Definition> = Event<Def> & { type: string }

  export type ProjectorFunc = (db: Database.TxOrDb, data: any, event: Event) => void

  type ConvertEvent = (type: string, data: unknown) => Record<string, unknown>

  export const registry = new Map<string, Definition>()
  const versions = new Map<string, number>()
  const projectors = new Map<Definition, ProjectorFunc>()
  const converters: ConvertEvent[] = []

  type Listener = (input: { def: Definition; event: Event }) => void
  const listeners = new Set<Listener>()

  // ============================================================================
  // Definition
  // ============================================================================

  export function versionedType<A extends string>(type: A): A
  export function versionedType<A extends string, B extends number>(type: A, version: B): `${A}.${B}`
  export function versionedType(type: string, version?: number) {
    return version === undefined ? type : `${type}.${version}`
  }

  /**
   * Register an event. `aggregate` names the field on the payload that
   * carries the aggregate id (`"sessionID"`, `"workspaceID"`, …) — the type
   * parameter forces the schema to actually declare it, so `run` can never
   * be handed a payload it cannot sequence.
   */
  export function define<
    Type extends string,
    Agg extends string,
    Schema extends ZodObject<Record<Agg, z.ZodType<string>>>,
    BusSchema extends ZodObject = Schema,
  >(input: {
    type: Type
    version: number
    aggregate: Agg
    schema: Schema
    busSchema?: BusSchema
    bus?: () => BusEvent.Definition
    log?: boolean
  }) {
    const def = {
      type: input.type,
      version: input.version,
      aggregate: input.aggregate,
      schema: input.schema,
      properties: (input.busSchema ?? input.schema) as ZodObject,
      bus: input.bus,
      log: input.log ?? true,
    }

    versions.set(def.type, Math.max(def.version, versions.get(def.type) ?? 0))
    registry.set(versionedType(def.type, def.version), def)

    return def as typeof def & { type: Type; aggregate: Agg; schema: Schema; properties: BusSchema }
  }

  /** Pair an event definition with the projector that applies it. */
  export function project<Def extends Definition>(
    def: Def,
    func: (db: Database.TxOrDb, data: Event<Def>["data"], event: Event<Def>) => void,
  ): [Definition, ProjectorFunc] {
    return [def, func as ProjectorFunc]
  }

  /**
   * Install a domain's projectors.
   *
   * Additive, unlike opencode's `init`, which replaces the projector map and
   * then freezes the registry so a later `define` throws. nikcli loads
   * domains independently — and a test file that installs its own events
   * would otherwise poison every module loaded after it in the same process
   * — so installing merges and defining stays open.
   *
   * Only the latest version of each event is registered on the Bus: code
   * emits latest only, and replaying an old version never goes through the
   * Bus, so the Bus stays free of version suffixes.
   */
  export function init(input: { projectors: Array<[Definition, ProjectorFunc]>; convertEvent?: ConvertEvent }) {
    for (const [def, func] of input.projectors) projectors.set(def, func)

    for (const [type, version] of versions.entries()) {
      const def = registry.get(versionedType(type, version))
      if (!def) continue
      // Events layered over an existing bus registration keep it:
      // re-defining would replace an Effect Schema entry with a zod-only
      // one and break `BusEvent.schemas()`.
      if (def.bus) continue
      BusEvent.define(def.type, def.properties)
    }

    if (input.convertEvent && !converters.includes(input.convertEvent)) converters.push(input.convertEvent)
    log.info("projectors installed", { events: registry.size, projectors: projectors.size })
  }

  /** Drop every projector. Tests only. */
  export function reset() {
    projectors.clear()
    converters.length = 0
  }

  /** Whether a projector is installed for this definition. */
  export function installed(def: Definition) {
    return projectors.has(def)
  }

  export function initialized() {
    return projectors.size > 0
  }

  /** Apply every registered reshape, in installation order. */
  function convertEvent(type: string, data: unknown): Record<string, unknown> {
    let result = data as Record<string, unknown>
    for (const converter of converters) result = converter(type, result)
    return result
  }

  // ============================================================================
  // Execution
  // ============================================================================

  function record(def: Definition, event: Event): SyncEventRecord {
    return {
      id: event.id,
      projectId: event.projectID,
      aggregate: event.aggregateID,
      seq: event.seq,
      type: versionedType(def.type, def.version),
      data: event.data,
      timestamp: Date.now(),
      origin: "local",
    }
  }

  /**
   * Apply one event: project it, log it, then (post-commit) fan it out.
   *
   * The projector and the log row land in the same transaction, so a
   * projector that throws leaves no event behind claiming the mutation
   * happened. Publishing is deferred to `Database.effect` so subscribers
   * never observe a state that a rollback could still undo, and never run
   * while the write lock is held.
   */
  function process(def: Definition, event: Event, tx: Database.TxOrDb, options: { publish: boolean }) {
    const projector = projectors.get(def)
    if (!projector) {
      throw new Error(`Projector not found for event: ${def.type}`)
    }

    projector(tx, event.data, event)

    if (def.log) {
      tx.insert(syncEvent)
        .values({
          id: event.id,
          projectId: event.projectID,
          aggregate: event.aggregateID,
          seq: event.seq,
          type: versionedType(def.type, def.version),
          data: JSON.stringify(event.data),
          timestamp: Date.now(),
        })
        .run()

      tx.insert(syncSequence)
        .values({ projectId: event.projectID, aggregate: event.aggregateID, seq: event.seq })
        .onConflictDoUpdate({
          target: [syncSequence.projectId, syncSequence.aggregate],
          set: { seq: event.seq },
        })
        .run()
    }

    Database.effect(() => {
      const entry = { def, event }
      for (const listener of listeners) {
        try {
          listener(entry)
        } catch (error) {
          log.warn("sync event listener failed", { type: def.type, error })
        }
      }

      // The remote-sync outbox already listens here; routing sync events
      // through it makes every domain mutation pushable without new wiring.
      // Unlogged events have no durable row to push, so they stay local.
      if (def.log) Sync.notify(record(def, event), { origin: "local" })

      if (!options.publish) return
      try {
        void Bus.publish(
          def.bus?.() ?? { type: def.type, properties: def.properties },
          convertEvent(def.type, event.data),
        )
      } catch (error) {
        log.error("failed to publish sync event on the bus", { type: def.type, error })
      }
    })
  }

  function currentProject(): string {
    // Read in caller scope: `Instance` is AsyncLocalStorage-backed and a
    // lookup from inside an Effect fiber loses the context.
    return Instance.project.id
  }

  /**
   * Run an event: allocate its sequence number, project it, log it, publish
   * it. This is the only way domain code should mutate synced state.
   */
  export function run<Def extends Definition>(
    def: Def,
    data: Event<Def>["data"],
    options?: { publish?: boolean; projectID?: string },
  ): Event<Def> {
    const aggregateID = (data as Record<string, unknown>)[def.aggregate]
    if (typeof aggregateID !== "string" || aggregateID === "") {
      throw new Error(`SyncEvent.run: "${def.aggregate}" required but not found: ${JSON.stringify(data)}`)
    }

    if (def.version !== versions.get(def.type)) {
      throw new Error(`SyncEvent.run: running old versions of events is not allowed: ${def.type}`)
    }

    const projectID = options?.projectID ?? currentProject()
    const publish = options?.publish ?? true

    // BEGIN IMMEDIATE: the sequence read and the append have to be atomic
    // even across processes sharing nikcli.db.
    return Database.transaction((tx) => {
      const row = def.log
        ? tx
            .select({ seq: syncSequence.seq })
            .from(syncSequence)
            .where(and(eq(syncSequence.projectId, projectID), eq(syncSequence.aggregate, aggregateID)))
            .get()
        : undefined

      const event: Event<Def> = {
        id: Identifier.ascending("sync"),
        seq: (row?.seq ?? 0) + 1,
        aggregateID,
        projectID,
        data,
      }
      process(def, event as Event, tx, { publish })
      return event
    })
  }

  /**
   * Apply an event received from elsewhere (a remote hub, a log replay).
   *
   * Out-of-order delivery is a bug in a single-writer system, so a gap is
   * fatal rather than buffered; an event already applied is silently
   * ignored, which is what makes redelivery safe.
   */
  export function replay(event: SerializedEvent, options?: { publish?: boolean }) {
    const def = registry.get(event.type) ?? registry.get(versionedType(event.type, versions.get(event.type) ?? 0))
    if (!def) {
      throw new Error(`Unknown event type: ${event.type}`)
    }

    return Database.transaction((tx) => {
      const row = tx
        .select({ seq: syncSequence.seq })
        .from(syncSequence)
        .where(and(eq(syncSequence.projectId, event.projectID), eq(syncSequence.aggregate, event.aggregateID)))
        .get()

      const latest = row?.seq ?? 0
      if (event.seq <= latest) return

      const expected = latest + 1
      if (event.seq !== expected) {
        throw new Error(
          `Sequence mismatch for aggregate "${event.aggregateID}": expected ${expected}, got ${event.seq}`,
        )
      }

      process(def, event, tx, { publish: options?.publish ?? false })
    })
  }

  /** One durable row of the log, as served to clients. */
  export const HistoryEntry = z
    .object({
      id: z.string(),
      seq: z.number().int(),
      type: z.string(),
      data: z.unknown(),
      timestamp: z.number(),
    })
    .meta({ ref: "SyncEvent.HistoryEntry" })
  export type HistoryEntry = z.infer<typeof HistoryEntry>

  /**
   * The durable log for one aggregate, in sequence order.
   *
   * Events defined `log: false` are absent by construction — see the flag on
   * `Definition`.
   */
  export function history(aggregateID: string, projectID?: string): HistoryEntry[] {
    const project = projectID ?? currentProject()
    const rows = Database.use((db) =>
      db
        .select({
          id: syncEvent.id,
          seq: syncEvent.seq,
          type: syncEvent.type,
          data: syncEvent.data,
          timestamp: syncEvent.timestamp,
        })
        .from(syncEvent)
        .where(and(eq(syncEvent.projectId, project), eq(syncEvent.aggregate, aggregateID)))
        .orderBy(asc(syncEvent.seq))
        .all(),
    )
    return rows.map((row) => ({
      id: row.id,
      seq: row.seq,
      type: row.type,
      data: parse(row.data),
      timestamp: row.timestamp,
    }))
  }

  function parse(data: string): unknown {
    try {
      return JSON.parse(data)
    } catch {
      return null
    }
  }

  /** Drop the log and sequence for an aggregate. */
  export function remove(aggregateID: string, projectID?: string) {
    const project = projectID ?? currentProject()
    Database.transaction((tx) => {
      tx.delete(syncEvent)
        .where(and(eq(syncEvent.projectId, project), eq(syncEvent.aggregate, aggregateID)))
        .run()
      tx.delete(syncSequence)
        .where(and(eq(syncSequence.projectId, project), eq(syncSequence.aggregate, aggregateID)))
        .run()
    })
  }

  /**
   * Receive every sync event. Individual events are subscribed to through
   * `Bus.subscribe(def, handler)` — this exists for recorders (sync
   * transport, debugging) that need the whole stream with its metadata.
   */
  export function subscribeAll(handler: Listener) {
    listeners.add(handler)
    return () => {
      listeners.delete(handler)
    }
  }

  /** OpenAPI payload union of every registered event. */
  export function payloads() {
    return z
      .union(
        registry
          .entries()
          .map(([type, def]) =>
            z
              .object({
                type: z.literal(type),
                aggregate: z.literal(def.aggregate),
                data: def.schema,
              })
              .meta({ ref: "SyncEvent." + def.type }),
          )
          .toArray() as any,
      )
      .meta({ ref: "SyncEvent" })
  }
}
