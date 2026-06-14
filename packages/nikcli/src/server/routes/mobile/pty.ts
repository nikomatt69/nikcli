import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import { upgradeWebSocket } from "hono/bun"
import z from "zod"
import { Pty } from "@/pty"
import { Storage } from "@/storage/storage"
import { errors } from "../../error"
import { runPty } from "./helpers"
import { Effect } from "effect"

export const PtyRoutes = () =>
  new Hono()
    .get(
      "/pty",
      describeRoute({
        summary: "List PTY sessions for mobile",
        description: "Get a list of all active pseudo-terminal (PTY) sessions managed by Nikcli.",
        operationId: "mobile.pty.list",
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
      "/pty",
      describeRoute({
        summary: "Create PTY session for mobile",
        description: "Create a new pseudo-terminal (PTY) session for running shell commands and processes.",
        operationId: "mobile.pty.create",
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
      "/pty/:ptyID",
      describeRoute({
        summary: "Get PTY session for mobile",
        description: "Retrieve detailed information about a specific pseudo-terminal (PTY) session.",
        operationId: "mobile.pty.get",
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
      validator("param", z.object({ ptyID: z.string() })),
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
      "/pty/:ptyID",
      describeRoute({
        summary: "Update PTY session for mobile",
        description: "Update properties of an existing pseudo-terminal (PTY) session.",
        operationId: "mobile.pty.update",
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
      validator("param", z.object({ ptyID: z.string() })),
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
      "/pty/:ptyID",
      describeRoute({
        summary: "Remove PTY session for mobile",
        description: "Remove and terminate a specific pseudo-terminal (PTY) session.",
        operationId: "mobile.pty.remove",
        responses: {
          200: {
            description: "Session removed",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ ptyID: z.string() })),
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
      "/pty/:ptyID/connect",
      describeRoute({
        summary: "Connect to PTY session for mobile",
        description: "Establish a WebSocket connection to interact with a pseudo-terminal (PTY) session in real-time.",
        operationId: "mobile.pty.connect",
        responses: {
          200: {
            description: "Connected session",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ ptyID: z.string() })),
      upgradeWebSocket((c) => {
        const id = c.req.param("ptyID")
        let handler: Pty.Connection | undefined
        return {
          async onOpen(_event, ws) {
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
            if (text.charCodeAt(0) === 123 /* { */) {
              try {
                const msg = JSON.parse(text) as Record<string, unknown>
                if (msg.type === "resize" && typeof msg.cols === "number" && typeof msg.rows === "number") {
                  void runPty(
                    Effect.gen(function* () {
                      const pty = yield* Pty.Service
                      yield* pty.resize(id, msg.cols as number, msg.rows as number)
                    }),
                  ).catch(() => {})
                  return
                }
              } catch {
                // Not a JSON control message — fall through and treat it as PTY input.
              }
            }
            handler?.onMessage(text)
          },
          onClose() {
            handler?.onClose()
          },
        }
      }),
    )
