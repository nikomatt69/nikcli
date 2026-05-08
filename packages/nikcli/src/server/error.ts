import { resolver } from "hono-openapi"
import { Storage } from "../storage/storage"
import { Schema } from "effect"
import { zodObject, zodObjectMode } from "@/util/effect-zod"

const BadRequestErrorSchema = Schema.Struct({
  data: Schema.Any,
  errors: Schema.Array(Schema.Record({ key: Schema.String, value: Schema.Any })),
  success: Schema.Literal(false),
}).annotations({
  identifier: "BadRequestError",
  ...zodObjectMode("strip"),
})

export const ERRORS = {
  400: {
    description: "Bad request",
    content: {
      "application/json": {
        schema: resolver(zodObject(BadRequestErrorSchema)),
      },
    },
  },
  404: {
    description: "Not found",
    content: {
      "application/json": {
        schema: resolver(Storage.NotFoundError.Schema),
      },
    },
  },
} as const

export function errors(...codes: number[]) {
  return Object.fromEntries(codes.map((code) => [code, ERRORS[code as keyof typeof ERRORS]]))
}
