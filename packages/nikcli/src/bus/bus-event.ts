import type { ZodType } from "zod"
import { Effect, Schema } from "effect"
import { resolve } from "effect/SchemaAST"
import { zodObject, zodObjectMode } from "@nikcli-ai/util/effect-zod"
import { Log } from "@nikcli-ai/util/log"

export namespace BusEvent {
  const log = Log.create({ service: "event" })

  /**
   * Whether an event may leave the process on the public SSE feed.
   *
   * `internal` events still reach in-process `Bus.subscribe` callers exactly as
   * before — two of them exist precisely because a module waits on its own work
   * over the bus — but they are withheld from `/event` and `/global/event`, and
   * they are absent from the generated `Event` union so no client can type
   * against something it will never receive.
   *
   * The bit lives on the declaration rather than in a list inside the feed. A
   * list away from the thing it describes is the shape that drifts: nothing
   * forces the two to agree, and the failure — an internal event quietly going
   * public — reports itself nowhere.
   *
   * See `specs/v2/public-event-filter.md`.
   */
  export type Visibility = "public" | "internal"

  export type Definition = {
    type: string
    properties: ZodType
    /** Present when the event payload was defined via `BusEvent.schema` (Effect Schema). */
    schema?: Schema.Top
    /** Defaults to `"public"`. */
    visibility?: Visibility
  }

  export type Options = {
    visibility?: Visibility
  }

  const registry = new Map<string, Definition>()

  export function define<Type extends string, Properties extends ZodType>(
    type: Type,
    properties: Properties,
    options?: Options,
  ) {
    const result = {
      type,
      properties,
      visibility: options?.visibility ?? ("public" as const),
    }
    registry.set(type, result)
    return result
  }

  /** Is this event withheld from the public SSE feed? Unknown types are public. */
  export function isInternal(type: string | undefined): boolean {
    if (!type) return false
    return registry.get(type)?.visibility === "internal"
  }

  /** The withheld types, for tests and audits. */
  export function internalTypes(): string[] {
    return registry
      .values()
      .filter((def) => def.visibility === "internal")
      .map((def) => def.type)
      .toArray()
  }

  /**
   * Effect-Schema flavored `define`. Anonymous payload structs are annotated with
   * strip mode at the top level so the derived zod payload keeps the legacy
   * `z.object` parse semantics (legacy defines used plain `z.object(...)`, i.e.
   * strip; the walker defaults to strict). Named schemas (with an `identifier`
   * annotation, e.g. PermissionRequest) are shared OpenAPI components whose mode
   * is their own — they pass through untouched.
   */
  export function schema<Type extends string, Fields extends Schema.Struct.Fields>(
    type: Type,
    properties: Schema.Struct<Fields>,
    options?: Options,
  ) {
    const annotations = resolve(properties.ast) as Record<PropertyKey, unknown> | undefined
    const hasIdentifier = typeof annotations?.identifier === "string"
    const annotated = hasIdentifier ? properties : properties.annotate(zodObjectMode("strip"))
    const result = {
      type,
      properties: zodObject(annotated),
      schema: annotated as Schema.Top,
      visibility: options?.visibility ?? ("public" as const),
    }
    registry.set(type, result)
    return result
  }

  /** Encoder per event type, built on first use. `null` marks a type that has no
   *  Effect Schema (legacy `define`) or whose encoder could not be built. */
  const encoders = new Map<string, ((value: unknown) => unknown) | null>()

  /** Encoded payload per event object. `Bus.subscribeAll` hands the same object to
   *  every subscriber, so this collapses N SSE connections into one encode. */
  const encoded = new WeakMap<object, Wire>()

  type Wire = { readonly type: string; readonly properties: unknown }

  function encoderFor(type: string) {
    const cached = encoders.get(type)
    if (cached !== undefined) return cached
    const definition = registry.get(type)
    let encoder: ((value: unknown) => unknown) | null = null
    if (definition?.schema) {
      try {
        // `Definition.schema` is a `Schema.Top`, whose EncodingServices is
        // `unknown`; every registered event encodes without services, so narrow
        // to the service-free codec the sync encoder requires.
        encoder = Schema.encodeUnknownSync(definition.schema as Schema.Codec<unknown, unknown, never, never>)
      } catch (error) {
        log.warn("failed to build event encoder; sending payloads raw", { type, error })
      }
    }
    encoders.set(type, encoder)
    return encoder
  }

  /**
   * Resolves `experimental.events.schemaEncoding` once, for a caller that is
   * about to encode many events (an SSE connection). Reading config per event
   * would put an Effect round-trip on the hot path.
   *
   * Off by default: encoding drops keys the schema does not declare, and this
   * repo has been bitten before by tightening a schema against real payloads
   * (see `specs/opencode-parity/07-tui-v2-selective-port.md`).
   */
  export async function encodingEnabled(): Promise<boolean> {
    try {
      const { Config } = await import("../config/config")
      const { features } = await import("@nikcli-ai/util/features")
      const { runPromiseWithLayer, withCurrentInstance } = await import("../effect")
      const config = await runPromiseWithLayer(
        Config.defaultLayer,
        withCurrentInstance(
          Effect.gen(function* () {
            const service = yield* Config.Service
            return yield* service.get()
          }),
        ),
      )
      return features(config).events.schemaEncoding
    } catch (error) {
      // A stream must never fail to open because a flag could not be read.
      log.debug("could not resolve event schema encoding flag; leaving it off", { error })
      return false
    }
  }

  /**
   * Projects an event onto its declared wire shape before it leaves the process.
   *
   * The bus carries runtime values — Dates, class instances, whatever extra keys
   * the publisher happened to attach — so serializing them raw makes the wire
   * contract depend on the producer instead of on the schema clients decode
   * against. Encoding here is the mirror of the runtime validation the HTTP
   * bridge already does on responses.
   *
   * Never drops an event: unmigrated (zod-only) types and payloads their own
   * schema rejects pass through unchanged, loudly. A client that receives an
   * event it only partly understands is better off than one that never hears it.
   */
  export function encode<E extends Wire>(event: E): E | Wire {
    const encoder = encoderFor(event.type)
    if (!encoder) return event
    const hit = encoded.get(event)
    if (hit) return hit
    try {
      const wire: Wire = { ...event, properties: encoder(event.properties) }
      encoded.set(event, wire)
      return wire
    } catch (error) {
      log.warn("event payload failed to encode; sending raw", { type: event.type, error })
      encoded.set(event, event)
      return event
    }
  }

  /** Event types still registered through the legacy zod `define` (no Effect Schema yet). */
  export function unmigrated() {
    return publicDefinitions()
      .filter((def) => !def.schema)
      .map((def) => def.type)
  }

  /**
   * Every event that may reach a client. Internal events are excluded here
   * rather than at each call site, so the contract, the migration check and any
   * future consumer cannot disagree about what "public" means.
   */
  function publicDefinitions() {
    return registry
      .values()
      .filter((def) => def.visibility !== "internal")
      .toArray()
  }

  /**
   * Effect Schema union of every **public** registered event.
   *
   * Requires every one of them to be registered via `BusEvent.schema` — throws
   * otherwise, listing the stragglers, so the Effect PublicApi contract can
   * never silently publish a partial Event union. Internal events are exempt
   * from that requirement because they are not on the contract at all.
   */
  export function schemas() {
    const missing = unmigrated()
    if (missing.length > 0) {
      throw new Error(`BusEvent.schemas(): events not migrated to Effect Schema: ${missing.join(", ")}`)
    }
    const members = publicDefinitions()
      .map((def) =>
        Schema.Struct({
          type: Schema.Literal(def.type),
          properties: def.schema!,
        }).annotate({ identifier: "Event." + def.type }),
      )
    return Schema.Union(members as unknown as [Schema.Top, Schema.Top, ...Schema.Top[]]).annotate({
      identifier: "Event",
      discriminator: "type",
    })
  }
}
