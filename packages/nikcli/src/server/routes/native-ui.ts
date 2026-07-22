import { Hono } from "hono"
import { streamSSE } from "hono/streaming"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { NativeUI } from "../../native-ui"
import {
  ActionTypeSchema,
  CapabilitiesSchema,
  ControlTypeSchema,
  PROTOCOL_VERSION,
  SurfaceEventSchema,
  SurfaceKindSchema,
  SurfaceSchema,
} from "@nikcli-ai/native-ui-protocol"

const SurfaceID = z.object({ id: z.string().min(1) })

export const NativeUIRoutes = () =>
  new Hono()
    .get(
      "/capabilities",
      describeRoute({
        summary: "Get native UI capabilities",
        operationId: "native-ui.capabilities",
        responses: {
          200: {
            description: "Native UI capabilities",
            content: {
              "application/json": { schema: resolver(CapabilitiesSchema) },
            },
          },
        },
      }),
      (c) =>
        c.json({
          version: PROTOCOL_VERSION,
          surfaces: SurfaceKindSchema.options,
          controls: ControlTypeSchema.options,
          actions: ActionTypeSchema.options,
          maxSurfaces: NativeUI.MAX_SURFACES,
        }),
    )
    .get(
      "/surfaces",
      describeRoute({
        summary: "List native UI surfaces",
        operationId: "native-ui.list",
        responses: {
          200: {
            description: "Native UI surfaces",
            content: {
              "application/json": { schema: resolver(z.array(SurfaceSchema)) },
            },
          },
        },
      }),
      (c) => c.json(NativeUI.list()),
    )
    .post("/surfaces", validator("json", SurfaceSchema), (c) => {
      try {
        return c.json(NativeUI.open(c.req.valid("json")))
      } catch (error) {
        return c.json({ error: error instanceof Error ? error.message : String(error) }, 409)
      }
    })
    .put("/surfaces/:id", validator("param", SurfaceID), validator("json", SurfaceSchema), (c) => {
      const input = c.req.valid("json")
      if (input.id !== c.req.valid("param").id) return c.json({ error: "Surface id mismatch" }, 400)
      try {
        return c.json(NativeUI.update(input))
      } catch (error) {
        return c.json({ error: error instanceof Error ? error.message : String(error) }, 404)
      }
    })
    .delete("/surfaces/:id", validator("param", SurfaceID), (c) => {
      NativeUI.close(c.req.valid("param").id, "system")
      return c.body(null, 204)
    })
    .post("/events", validator("json", SurfaceEventSchema), (c) => {
      try {
        return c.json(NativeUI.dispatch(c.req.valid("json")))
      } catch (error) {
        return c.json({ error: error instanceof Error ? error.message : String(error) }, 400)
      }
    })
    .get("/events", (c) =>
      streamSSE(c, async (stream) => {
        let resolve: (() => void) | undefined
        const unsubscribe = NativeUI.subscribe((event) => {
          void stream.writeSSE({ data: JSON.stringify(event) }).catch(() => resolve?.())
        })
        const heartbeat = setInterval(() => {
          void stream.writeSSE({ data: "", event: "heartbeat" }).catch(() => resolve?.())
        }, 30_000)
        stream.onAbort(() => resolve?.())
        try {
          await new Promise<void>((done) => {
            resolve = done
          })
        } finally {
          clearInterval(heartbeat)
          unsubscribe()
        }
      }),
    )
