import z from "zod"
import type { ZodType } from "zod"
import { Log } from "../util/log"
import { Schema } from "effect"
import { zod as zodFromSchema, zodObject as zodObjectFromSchema } from "@/util/effect-zod"

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
  export function define<Type extends string, Fields extends Schema.Struct.Fields>(
    type: Type,
    schema: Schema.Struct<Fields>,
  ): Definition<Type, ReturnType<typeof zodObjectFromSchema<Fields>>>
  export function define<Type extends string>(type: Type, properties: ZodType | Schema.Struct<any>): Definition<Type> {
    const isEffectSchema = "ast" in properties
    const result = {
      type,
      properties: isEffectSchema ? zodObjectFromSchema(properties as Schema.Struct<any>) : properties,
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
