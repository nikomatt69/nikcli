import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import { upgradeWebSocket } from "hono/bun"
import { Pty } from "@/pty"
import { Storage } from "../../storage/storage"
import { errors } from "../error"
import { lazy } from "../../util/lazy"
import { runPromiseWithLayer, withCurrentInstance } from "@/effect"
import { Effect, Schema } from "effect"
import { zod, zodObject, zodObjectMode } from "@/util/effect-zod"

const PtyParam = zodObject(
  Schema.Struct({
    ptyID: Schema.String,
  }).annotations(zodObjectMode("strip")),
)
const BooleanResponse = zod(Schema.Boolean)

function runPty<A, E>(effect: Effect.Effect<A, E, Pty.Service>) {
  return runPromiseWithLayer(Pty.defaultLayer, withCurrentInstance(effect))
}

export const PtyRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "List PTY sessions",
        description: "Get a list of all active pseudo-terminal (PTY) sessions managed by Nikcli.",
        operationId: "pty.list",
        responses: {
          200: {
            description: "List of sessions",
            content: {
              "application/json": {
                schema: resolver(Pty.Info.array()),
              },
            },
          },
        },
      }),
      async (c) => {
        const list = await runPty(
          Effect.gen(function* () {
            const pty = yield* Pty.Service
            return yield* pty.list()
          }),
        )
        return c.json(list)
      },
    )
    .post(
      "/",
      describeRoute({
        summary: "Create PTY session",
        description: "Create a new pseudo-terminal (PTY) session for running shell commands and processes.",
        operationId: "pty.create",
        responses: {
          200: {
            description: "Created session",
            content: {
              "application/json": {
                schema: resolver(Pty.Info),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", Pty.CreateInput),
      async (c) => {
        const input = c.req.valid("json")
        const info = await runPty(
          Effect.gen(function* () {
            const pty = yield* Pty.Service
            return yield* pty.create(input)
          }),
        )
        return c.json(info)
      },
    )
    .get(
      "/:ptyID",
      describeRoute({
        summary: "Get PTY session",
        description: "Retrieve detailed information about a specific pseudo-terminal (PTY) session.",
        operationId: "pty.get",
        responses: {
          200: {
            description: "Session info",
            content: {
              "application/json": {
                schema: resolver(Pty.Info),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", PtyParam),
      async (c) => {
        const { ptyID } = c.req.valid("param")
        const info = await runPty(
          Effect.gen(function* () {
            const pty = yield* Pty.Service
            return yield* pty.get(ptyID)
          }),
        )
        if (!info) {
          throw new Storage.NotFoundError({ message: "Session not found" })
        }
        return c.json(info)
      },
    )
    .put(
      "/:ptyID",
      describeRoute({
        summary: "Update PTY session",
        description: "Update properties of an existing pseudo-terminal (PTY) session.",
        operationId: "pty.update",
        responses: {
          200: {
            description: "Updated session",
            content: {
              "application/json": {
                schema: resolver(Pty.Info),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("param", PtyParam),
      validator("json", Pty.UpdateInput),
      async (c) => {
        const { ptyID } = c.req.valid("param")
        const input = c.req.valid("json")
        const info = await runPty(
          Effect.gen(function* () {
            const pty = yield* Pty.Service
            return yield* pty.update(ptyID, input)
          }),
        )
        return c.json(info)
      },
    )
    .delete(
      "/:ptyID",
      describeRoute({
        summary: "Remove PTY session",
        description: "Remove and terminate a specific pseudo-terminal (PTY) session.",
        operationId: "pty.remove",
        responses: {
          200: {
            description: "Session removed",
            content: {
              "application/json": {
                schema: resolver(BooleanResponse),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", PtyParam),
      async (c) => {
        const { ptyID } = c.req.valid("param")
        await runPty(
          Effect.gen(function* () {
            const pty = yield* Pty.Service
            yield* pty.remove(ptyID)
          }),
        )
        return c.json(true)
      },
    )
    .get(
      "/:ptyID/connect",
      describeRoute({
        summary: "Connect to PTY session",
        description: "Establish a WebSocket connection to interact with a pseudo-terminal (PTY) session in real-time.",
        operationId: "pty.connect",
        responses: {
          200: {
            description: "Connected session",
            content: {
              "application/json": {
                schema: resolver(BooleanResponse),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", PtyParam),
      upgradeWebSocket((c) => {
        const id = c.req.param("ptyID")
        // Log connection attempt for debugging
        console.log(`[PTY] WebSocket connection attempt for session: ${id}`)
        let handler: Pty.Connection | undefined
        return {
          async onOpen(_event, ws) {
            console.log(`[PTY] WebSocket opened for session: ${id}`)
            handler = await runPty(
              Effect.gen(function* () {
                const pty = yield* Pty.Service
                return yield* pty.connect(id, ws)
              }),
            )
          },
          onMessage(event) {
            const raw = event.data
            const text = raw instanceof ArrayBuffer ? new TextDecoder().decode(raw) : String(raw)
            // Intercept JSON resize control messages so they don't land in the PTY as input.
            if (text.charCodeAt(0) === 123 /* { */) {
              try {
                const msg = JSON.parse(text) as Record<string, unknown>
                if (msg.type === "resize" && typeof msg.cols === "number" && typeof msg.rows === "number") {
                  void runPty(
                    Effect.gen(function* () {
                      const pty = yield* Pty.Service
                      yield* pty.resize(id, msg.cols as number, msg.rows as number)
                    }),
                  )
                  return
                }
              } catch {}
            }
            handler?.onMessage(text)
          },
          onClose() {
            console.log(`[PTY] WebSocket closed for session: ${id}`)
            handler?.onClose()
          },
        }
      }),
    ),
)
