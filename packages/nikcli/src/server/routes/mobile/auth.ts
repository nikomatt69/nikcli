import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { MobileAuth } from "@/mobile/auth"

export const AuthRoutes = () =>
  new Hono()
    .post(
      "/auth/token",
      describeRoute({
        summary: "Create mobile auth token",
        description: "Exchange valid Basic auth credentials for a long-lived mobile Bearer token.",
        operationId: "mobile.auth.token.create",
        responses: {
          200: {
            description: "Mobile token",
            content: {
              "application/json": {
                schema: resolver(z.object({ token: z.string(), info: MobileAuth.PublicToken })),
              },
            },
          },
        },
      }),
      validator(
        "json",
        z
          .object({
            name: z.string().optional(),
            expiresInDays: z.number().optional(),
          })
          .optional(),
      ),
      async (c) => {
        const body = c.req.valid("json")
        const result = await MobileAuth.create(body ?? undefined)
        return c.json(result)
      },
    )
    .delete(
      "/auth/token/:id",
      describeRoute({
        summary: "Revoke mobile auth token",
        description: "Revoke a previously issued mobile Bearer token.",
        operationId: "mobile.auth.token.revoke",
        responses: {
          200: {
            description: "Token revoked",
            content: { "application/json": { schema: resolver(z.object({ revoked: z.boolean() })) } },
          },
        },
      }),
      validator("param", z.object({ id: z.string() })),
      async (c) => {
        const removed = await MobileAuth.remove(c.req.valid("param").id)
        return c.json({ revoked: removed })
      },
    )
    .get(
      "/auth/token",
      describeRoute({
        summary: "List mobile auth tokens",
        description: "List all active mobile Bearer tokens.",
        operationId: "mobile.auth.token.list",
        responses: {
          200: {
            description: "Token list",
            content: { "application/json": { schema: resolver(MobileAuth.PublicToken.array()) } },
          },
        },
      }),
      async (c) => {
        return c.json(await MobileAuth.list())
      },
    )
