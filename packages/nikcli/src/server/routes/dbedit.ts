import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { DBEditNext } from "@/permission/dbedit"
import { errors } from "../error"
import { lazy } from "../../util/lazy"

export const DBEditRoutes = lazy(() =>
  new Hono()
    .post(
      "/:requestID/reply",
      describeRoute({
        summary: "Respond to database edit request",
        description: "Accept, edit, or reject a database edit request from the AI assistant.",
        operationId: "dbedit.reply",
        responses: {
          200: {
            description: "DB edit processed successfully",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          requestID: z.string(),
        }),
      ),
      validator(
        "json",
        z.object({
          reply: DBEditNext.Reply,
          modified: DBEditNext.Request.optional(),
          message: z.string().optional(),
        }),
      ),
      async (c) => {
        const params = c.req.valid("param")
        const json = c.req.valid("json")
        await DBEditNext.reply({
          requestID: params.requestID,
          reply: json.reply,
          modified: json.modified,
          message: json.message,
        })
        return c.json(true)
      },
    )
    .get(
      "/",
      describeRoute({
        summary: "List pending DB edits",
        description: "Get all pending database edit requests across all sessions.",
        operationId: "dbedit.list",
        responses: {
          200: {
            description: "List of pending DB edits",
            content: {
              "application/json": {
                schema: resolver(DBEditNext.Request.array()),
              },
            },
          },
        },
      }),
      async (c) => {
        const dbedits = await DBEditNext.list()
        return c.json(dbedits)
      },
    ),
)
