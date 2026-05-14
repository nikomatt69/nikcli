import { resolver } from "hono-openapi"
import z from "zod"

export const BadRequestErrorSchema = z
  .object({
    message: z.string(),
    errors: z.array(z.record(z.string(), z.unknown())).optional(),
    success: z.literal(false),
  })
  .meta({
    ref: "BadRequestError",
  })

export const ERRORS = {
  400: {
    description: "Bad request",
    content: {
      "application/json": {
        schema: resolver(BadRequestErrorSchema),
      },
    },
  },
  404: {
    description: "Not found",
    content: {
      "application/json": {
        schema: resolver(
          z.object({ name: z.literal("NotFoundError"), data: z.object({ message: z.string() }) }).meta({ ref: "NotFoundError" }),
        ),
      },
    },
  },
} as const

export function errors(...codes: number[]) {
  return Object.fromEntries(codes.map((code) => [code, ERRORS[code as keyof typeof ERRORS]]))
}
