import z from "zod"
import type { ZodType } from "zod"
import { Effect, Schema } from "effect"
import { resolve } from "effect/SchemaAST"
import { zodObject, zodObjectMode } from "../util/effect-zod"
import { Log } from "../util/log"

export namespace BusEvent {
  const log = Log.create({ service: "event" })

  export type Definition = {
    type: string
    properties: ZodType
    /** Present when the event payload was defined via `BusEvent.schema` (Effect Schema). */
    schema?: Schema.Top
  }

  const registry = new Map<string, Definition>()

  export function define<Type extends string, Properties extends ZodType>(type: Type, properties: Properties) {
    const result = {
      type,
      properties,
    }
    registry.set(type, result)
    return result
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
  ) {
    const annotations = resolve(properties.ast) as Record<PropertyKey, unknown> | undefined
    const hasIdentifier = typeof annotations?.identifier === "string"
    const annotated = hasIdentifier ? properties : properties.annotate(zodObjectMode("strip"))
    const result = {
      type,
      properties: zodObject(annotated),
      schema: annotated as Schema.Top,
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
   * repo has been bitten before by tightening a schema against real payloads.
   */
  export async function encodingEnabled(): Promise<boolean> {
    try {
      const { Config } = await import("../config/config")
      const { features } = await import("../config/features")
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
    return registry
      .values()
      .filter((def) => !def.schema)
      .map((def) => def.type)
      .toArray()
  }

  export function payloads() {
    return z
      .discriminatedUnion(
        "type",
        registry
          .entries()
          .map(([type, def]) => {
            return z
              .object({
                type: z.literal(type),
                properties: def.properties,
              })
              .meta({
                ref: "Event" + "." + def.type,
              })
          })
          .toArray() as any,
      )
      .meta({
        ref: "Event",
      })
  }

  /**
   * Effect Schema union of every registered event, mirroring `payloads()`.
   * Requires every event to be registered via `BusEvent.schema` — throws otherwise,
   * listing the stragglers, so the Effect PublicApi contract can never silently
   * publish a partial Event union.
   */
  export function schemas() {
    const missing = unmigrated()
    if (missing.length > 0) {
      throw new Error(`BusEvent.schemas(): events not migrated to Effect Schema: ${missing.join(", ")}`)
    }
    const members = registry
      .entries()
      .map(([type, def]) =>
        Schema.Struct({
          type: Schema.Literal(type),
          properties: def.schema!,
        }).annotate({ identifier: "Event." + type }),
      )
      .toArray()
    return Schema.Union(members as unknown as [Schema.Top, Schema.Top, ...Schema.Top[]]).annotate({
      identifier: "Event",
      discriminator: "type",
    })
  }
}
