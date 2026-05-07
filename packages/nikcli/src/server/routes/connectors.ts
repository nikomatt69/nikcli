import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { Connectors } from "../../connectors"
import { ConnectorAuth } from "../../connectors/auth"
import { errors } from "../error"
import { lazy } from "../../util/lazy"
import { Effect } from "effect"
import { runPromiseWithLayer } from "@/effect"

function runConnectorAuth<A, E>(effect: Effect.Effect<A, E, ConnectorAuth.Service>) {
  return runPromiseWithLayer(ConnectorAuth.defaultLayer, effect)
}

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
        await runConnectorAuth(
          Effect.gen(function* () {
            const auth = yield* ConnectorAuth.Service
            const existing = yield* auth.get(name)
            yield* auth.set(name, { ...existing, ...payload })
          }),
        )
        Connectors.invalidateConnector(name)
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
        await runConnectorAuth(
          Effect.gen(function* () {
            const auth = yield* ConnectorAuth.Service
            yield* auth.remove(name)
          }),
        )
        Connectors.invalidateConnector(name)
        return c.json({ success: true as const })
      },
    )
    .post(
      "/invalidate",
      describeRoute({
        summary: "Invalidate connector cache",
        description: "Clear connector status and tools cache. Optionally invalidate a specific connector.",
        operationId: "connectors.invalidate",
        responses: {
          200: {
            description: "Cache invalidated",
            content: {
              "application/json": {
                schema: resolver(z.object({ success: z.literal(true) })),
              },
            },
          },
        },
      }),
      validator("json", z.object({
        name: z.string().optional().describe("Connector name to invalidate (optional, invalidates all if not provided)"),
      })),
      async (c) => {
        const { name } = c.req.valid("json")
        if (name) {
          Connectors.invalidateConnector(name)
        } else {
          Connectors.invalidateStatus()
          Connectors.invalidateTools()
        }
        return c.json({ success: true as const })
      },
    ),
)
