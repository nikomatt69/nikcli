import { z } from "zod"
import { Schema } from "effect"
import { zod as zodFromSchema } from "@/util/effect-zod"

type Wrapped<Input, Result, SchemaType extends z.ZodType> = {
  (input: Input): Result
  force(input: Input): Result
  schema: SchemaType
  effectSchema?: Schema.Schema<any, any, any>
}

function isEffectSchema(input: z.ZodType | Schema.Schema<any, any, any>): input is Schema.Schema<any, any, any> {
  return "ast" in input
}

export function fn<T extends z.ZodType, Result>(
  schema: T,
  cb: (input: z.infer<T>) => Result,
): Wrapped<z.input<T>, Result, T>
export function fn<S extends Schema.Schema<any, any, any>, Result>(
  schema: S,
  cb: (input: Schema.Schema.Type<S>) => Result,
): Wrapped<Schema.Schema.Encoded<S>, Result, z.ZodType<Schema.Schema.Type<S>>>
export function fn<Result>(
  schema: z.ZodType | Schema.Schema<any, any, any>,
  cb: (input: any) => Result,
): Wrapped<any, Result, z.ZodType> {
  let effectSchema: Schema.Schema<any, any, any> | undefined
  let validator: z.ZodType
  if (isEffectSchema(schema)) {
    effectSchema = schema
    validator = zodFromSchema(schema as Schema.Schema<any, any, never>)
  } else {
    validator = schema
  }
  const result = (input: any) => {
    const parsed = validator.parse(input)
    return cb(parsed)
  }
  result.force = (input: any) => cb(input)
  result.schema = validator
  if (effectSchema) result.effectSchema = effectSchema
  return result
}
