import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import { PermissionNext } from "@/permission/next"
import { errors } from "../error"
import { lazy } from "../../util/lazy"
import { Effect, Schema } from "effect"
import { runPromiseWithLayer, withCurrentInstance } from "@/effect"
import { zod, zodObject, zodObjectMode } from "@/util/effect-zod"

const BooleanResponse = zod(Schema.Boolean)
const RequestIDParam = zodObject(
  Schema.Struct({
    requestID: Schema.String,
  }).annotations(zodObjectMode("strip")),
)
const ReplyInput = zodObject(
  Schema.Struct({
    reply: PermissionNext.ReplySchema,
    message: Schema.optional(Schema.String),
  }).annotations(zodObjectMode("strip")),
)

function runPermission<A, E>(effect: Effect.Effect<A, E, PermissionNext.Service>) {
  return runPromiseWithLayer(PermissionNext.defaultLayer, withCurrentInstance(effect))
}

export const PermissionRoutes = lazy(() =>
  new Hono()
    .post(
      "/:requestID/reply",
      describeRoute({
        summary: "Respond to permission request",
        description: "Approve or deny a permission request from the AI assistant.",
        operationId: "permission.reply",
        responses: {
          200: {
            description: "Permission processed successfully",
            content: {
              "application/json": {
                schema: resolver(BooleanResponse),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        RequestIDParam,
      ),
      validator("json", ReplyInput),
      async (c) => {
        const params = c.req.valid("param")
        const json = c.req.valid("json")
        await runPermission(
          Effect.gen(function* () {
            const permission = yield* PermissionNext.Service
            yield* permission.reply({
              requestID: params.requestID,
              reply: json.reply,
              message: json.message,
            })
          }),
        )
        return c.json(true)
      },
    )
    .get(
      "/",
      describeRoute({
        summary: "List pending permissions",
        description: "Get all pending permission requests across all sessions.",
        operationId: "permission.list",
        responses: {
          200: {
            description: "List of pending permissions",
            content: {
              "application/json": {
                schema: resolver(PermissionNext.Request.array()),
              },
            },
          },
        },
      }),
      async (c) => {
        const permissions = await runPermission(
          Effect.gen(function* () {
            const permission = yield* PermissionNext.Service
            return yield* permission.list()
          }),
        )
        return c.json(permissions)
      },
    ),
)
