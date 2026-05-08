import z from "zod"
import type { ZodType } from "zod"
import { Log } from "../util/log"
import { Schema } from "effect"
import { zod as zodFromSchema } from "@/util/effect-zod"

export namespace BusEvent {
  const log = Log.create({ service: "event" })

  export type Definition<Type extends string = string, Properties extends ZodType = ZodType> = {
    type: Type
    properties: Properties
    schema?: Schema.Schema<any, any, any>
  }

  const registry = new Map<string, Definition>()

  export function define<Type extends string, Properties extends ZodType>(
    type: Type,
    properties: Properties,
  ): Definition<Type, Properties>
  export function define<Type extends string, Source extends Schema.Schema<any, any, any>>(
    type: Type,
    schema: Source,
  ): Definition<Type, z.ZodType<Schema.Schema.Type<Source>>>
  export function define<Type extends string>(
    type: Type,
    properties: ZodType | Schema.Schema<any, any, any>,
  ): Definition<Type> {
    const isEffectSchema = "ast" in properties
    const result = {
      type,
      properties: isEffectSchema ? zodFromSchema(properties as Schema.Schema<any, any, never>) : properties,
      ...(isEffectSchema ? { schema: properties } : {}),
    }
    registry.set(type, result)
    return result
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
}
