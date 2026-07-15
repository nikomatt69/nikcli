import z from "zod"
import type { ZodType } from "zod"
import { Schema } from "effect"
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
