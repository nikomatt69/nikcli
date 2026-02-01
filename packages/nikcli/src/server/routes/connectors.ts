import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { Connectors } from "../../connectors"
import { ConnectorAuth } from "../../connectors/auth"
import { errors } from "../error"
import { lazy } from "../../util/lazy"

const AuthInput = ConnectorAuth.Entry.refine(
  (value) => !!(value.token || value.botToken || value.apiKey),
  "Provide at least one credential field.",
)

export const ConnectorsRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "Get connectors status",
        description: "Get the status of all configured external service connectors.",
        operationId: "connectors.status",
        responses: {
          200: {
            description: "Connector status",
            content: {
              "application/json": {
                schema: resolver(z.record(z.string(), Connectors.StatusSchema)),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json(await Connectors.status())
      },
    )
    .post(
      "/:name/auth",
      describeRoute({
        summary: "Set connector credentials",
        description: "Store credentials for a connector.",
        operationId: "connectors.auth.set",
        responses: {
          200: {
            description: "Credentials saved",
            content: {
              "application/json": {
                schema: resolver(z.object({ success: z.literal(true) })),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", AuthInput),
      async (c) => {
        const name = c.req.param("name")
        const payload = c.req.valid("json")
        const existing = await ConnectorAuth.get(name)
        await ConnectorAuth.set(name, { ...existing, ...payload })
        return c.json({ success: true as const })
      },
    )
    .delete(
      "/:name/auth",
      describeRoute({
        summary: "Remove connector credentials",
        description: "Remove stored credentials for a connector.",
        operationId: "connectors.auth.remove",
        responses: {
          200: {
            description: "Credentials removed",
            content: {
              "application/json": {
                schema: resolver(z.object({ success: z.literal(true) })),
              },
            },
          },
          ...errors(404),
        },
      }),
      async (c) => {
        const name = c.req.param("name")
        await ConnectorAuth.remove(name)
        return c.json({ success: true as const })
      },
    ),
)
