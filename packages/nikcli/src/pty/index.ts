import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { type IPty } from "bun-pty"
import { Identifier } from "../id/id"
import { Log } from "../util/log"
import { Shell } from "@/shell/shell"
import { InstanceState } from "@/effect"
import { zodObject, type DeepMutable } from "@/util/effect-zod"
import { Context, Effect, Layer, Schema } from "effect"
import { PtyEnvironment } from "./environment"

export namespace Pty {
  const log = Log.create({ service: "pty" })

  const BUFFER_LIMIT = 1024 * 1024 * 2
  const BUFFER_CHUNK = 64 * 1024

  const loadSpawn = Effect.promise(async () => {
    const { spawn } = await import("bun-pty")
    return spawn
  })

  export const InfoSchema = Schema.Struct({
    id: Schema.String.pipe(Schema.check(Schema.isStartsWith("pty"))),
    title: Schema.String,
    command: Schema.String,
    args: Schema.Array(Schema.String),
    cwd: Schema.String,
    status: Schema.Literals(["running", "exited"]),
    pid: Schema.Number,
  }).annotate({ identifier: "Pty" })
  export const Info = zodObject(InfoSchema)
  export type Info = DeepMutable<Schema.Schema.Type<typeof InfoSchema>>

  const CreateInputSchema = Schema.Struct({
    command: Schema.optional(Schema.String),
    args: Schema.optional(Schema.Array(Schema.String)),
    cwd: Schema.optional(Schema.String),
    title: Schema.optional(Schema.String),
    env: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  })
  export const CreateInput = zodObject(CreateInputSchema)
  export type CreateInput = Schema.Schema.Type<typeof CreateInputSchema>

  const UpdateInputSchema = Schema.Struct({
    title: Schema.optional(Schema.String),
    size: Schema.optional(
      Schema.Struct({
        rows: Schema.Number,
        cols: Schema.Number,
      }),
    ),
  })
  export const UpdateInput = zodObject(UpdateInputSchema)
  export type UpdateInput = Schema.Schema.Type<typeof UpdateInputSchema>

  export const Event = {
    Created: BusEvent.schema("pty.created", Schema.Struct({ info: InfoSchema })),
    Updated: BusEvent.schema("pty.updated", Schema.Struct({ info: InfoSchema })),
    Exited: BusEvent.schema(
      "pty.exited",
      Schema.Struct({ id: Identifier.schemaEffect("pty"), exitCode: Schema.Number }),
    ),
    Deleted: BusEvent.schema("pty.deleted", Schema.Struct({ id: Identifier.schemaEffect("pty") })),
  }

  interface ActiveSession {
    info: Info
    process: IPty
    buffer: string
    subscribers: Set<Socket>
  }

  export interface Socket {
    readonly readyState: number
    readonly send: (data: string | ArrayBuffer | Uint8Array) => void
    readonly close: (code?: number, reason?: string) => void
  }

  export interface Connection {
    readonly onMessage: (message: string | ArrayBuffer) => void
    readonly onClose: () => void
  }

  export class CreateError extends Schema.TaggedErrorClass<CreateError>()("PtyCreateError", {
    command: Schema.String,
    cause: Schema.optional(Schema.Unknown),
  }) {
    override get message() {
      return `Failed to create PTY session for command: ${this.command}`
    }
  }

  /**
   * A PTY session was addressed by an ID that does not exist.
   *
   * The HTTP wire name stays the literal `"NotFoundError"` — boundaries must
   * emit that string rather than forwarding `_tag` (`PtyNotFoundError`).
   */
  export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("PtyNotFoundError", {
    message: Schema.String,
  }) {}

  /**
   * Union of all errors that any `Pty.Service` method can fail with. Use this
   * in the Effect error channel of downstream consumers so they can
   * `Effect.catchTag` against the specific error class.
   */
  export type Error = CreateError

  export interface Interface {
    readonly list: () => Effect.Effect<Info[], never>
    readonly get: (id: string) => Effect.Effect<Info | undefined, never>
    readonly create: (input: CreateInput) => Effect.Effect<Info, Error>
    readonly update: (id: string, input: UpdateInput) => Effect.Effect<Info | undefined, never>
    readonly remove: (id: string) => Effect.Effect<void, never>
    readonly resize: (id: string, cols: number, rows: number) => Effect.Effect<void, never>
    readonly write: (id: string, data: string) => Effect.Effect<void, never>
    readonly connect: (id: string, ws: Socket) => Effect.Effect<Connection | undefined, never>
  }

  export class Service extends Context.Service<Service, Interface>()("@nikcli/Pty") {}

  function closeSessions(sessions: Map<string, ActiveSession>) {
    for (const session of sessions.values()) {
      try {
        session.process.kill()
      } catch {}
      for (const ws of session.subscribers) {
        ws.close()
      }
    }
    sessions.clear()
  }

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const state = yield* InstanceState.make(() =>
        Effect.acquireRelease(
          Effect.sync(() => new Map<string, ActiveSession>()),
          (sessions) => Effect.sync(() => closeSessions(sessions)),
        ),
      )

      const cachedSpawn = yield* Effect.cached(loadSpawn)
      const environment = yield* PtyEnvironment.Service

      const list: Interface["list"] = Effect.fn("Pty.list")(function* () {
        return Array.from((yield* InstanceState.get(state)).values()).map((session) => session.info)
      })

      const get: Interface["get"] = Effect.fn("Pty.get")(function* (id: string) {
        return (yield* InstanceState.get(state)).get(id)?.info
      })

      const create: Interface["create"] = Effect.fn("Pty.create")(function* (input: CreateInput) {
        const sessions = yield* InstanceState.get(state)
        const directory = yield* InstanceState.directory
        const id = Identifier.create("pty", false)
        const command = input.command || Shell.preferred()
        const args = [...(input.args || [])]
        if (command.endsWith("sh")) {
          args.push("-l")
        }

        const cwd = input.cwd || directory
        // Precedence: process env < caller env < plugin overlay < forced terminal invariants.
        const overlay = yield* environment.get({ directory, cwd })
        const env = {
          ...process.env,
          ...input.env,
          ...overlay,
          TERM: "xterm-256color",
          NIKCLI_TERMINAL: "1",
        } as Record<string, string>
        log.info("creating session", { id, cmd: command, args, cwd })

        const spawn = yield* cachedSpawn
        const ptyProcess = yield* Effect.try({
          try: () =>
            spawn(command, args, {
              name: "xterm-256color",
              cwd,
              env,
            }),
          catch: (cause) => new CreateError({ command, cause }),
        })

        const info = {
          id,
          title: input.title || `Terminal ${id.slice(-4)}`,
          command,
          args,
          cwd,
          status: "running",
          pid: ptyProcess.pid,
        } as const
        const session: ActiveSession = {
          info,
          process: ptyProcess,
          buffer: "",
          subscribers: new Set(),
        }
        sessions.set(id, session)
        ptyProcess.onData((data) => {
          let open = false
          for (const ws of session.subscribers) {
            if (ws.readyState !== 1) {
              session.subscribers.delete(ws)
              continue
            }
            open = true
            ws.send(data)
          }
          if (open) return
          session.buffer += data
          if (session.buffer.length <= BUFFER_LIMIT) return
          session.buffer = session.buffer.slice(-BUFFER_LIMIT)
        })
        ptyProcess.onExit(({ exitCode }) => {
          log.info("session exited", { id, exitCode })
          ;(session.info as { status: "running" | "exited" }).status = "exited"
          for (const ws of session.subscribers) {
            ws.close()
          }
          session.subscribers.clear()
          void Bus.publish(Event.Exited, { id, exitCode })
          sessions.delete(id)
        })
        yield* Effect.promise(() => Bus.publish(Event.Created, { info }))
        return info
      })

      const update: Interface["update"] = Effect.fn("Pty.update")(function* (id: string, input: UpdateInput) {
        const session = (yield* InstanceState.get(state)).get(id)
        if (!session) return undefined
        if (input.title) {
          ;(session.info as { title: string }).title = input.title
        }
        if (input.size) {
          session.process.resize(input.size.cols, input.size.rows)
        }
        yield* Effect.promise(() => Bus.publish(Event.Updated, { info: session.info }))
        return session.info
      })

      const remove: Interface["remove"] = Effect.fn("Pty.remove")(function* (id: string) {
        const sessions = yield* InstanceState.get(state)
        const session = sessions.get(id)
        if (!session) return
        log.info("removing session", { id })
        try {
          session.process.kill()
        } catch {}
        for (const ws of session.subscribers) {
          ws.close()
        }
        sessions.delete(id)
        yield* Effect.promise(() => Bus.publish(Event.Deleted, { id }))
      })

      const resize: Interface["resize"] = Effect.fn("Pty.resize")(function* (id: string, cols: number, rows: number) {
        const session = (yield* InstanceState.get(state)).get(id)
        if (session && session.info.status === "running") {
          session.process.resize(cols, rows)
        }
      })

      const write: Interface["write"] = Effect.fn("Pty.write")(function* (id: string, data: string) {
        const session = (yield* InstanceState.get(state)).get(id)
        if (session && session.info.status === "running") {
          session.process.write(data)
        }
      })

      const connect: Interface["connect"] = Effect.fn("Pty.connect")(function* (id: string, ws: Socket) {
        const session = (yield* InstanceState.get(state)).get(id)
        if (!session) {
          ws.close()
          return undefined
        }
        log.info("client connected to session", { id })
        session.subscribers.add(ws)
        if (session.buffer) {
          const buffer = session.buffer.length <= BUFFER_LIMIT ? session.buffer : session.buffer.slice(-BUFFER_LIMIT)
          session.buffer = ""
          let sentUpTo = 0
          try {
            for (let i = 0; i < buffer.length; i += BUFFER_CHUNK) {
              ws.send(buffer.slice(i, i + BUFFER_CHUNK))
              sentUpTo = i + BUFFER_CHUNK
            }
          } catch {
            session.subscribers.delete(ws)
            session.buffer = buffer.slice(sentUpTo)
            ws.close()
            return undefined
          }
        }

        return {
          onMessage: (message: string | ArrayBuffer) => {
            const text = message instanceof ArrayBuffer ? new TextDecoder().decode(message) : message
            session.process.write(text)
          },
          onClose: () => {
            log.info("client disconnected from session", { id })
            session.subscribers.delete(ws)
          },
        }
      })

      return Service.of({
        list,
        get,
        create,
        update,
        remove,
        resize,
        write,
        connect,
      })
    }),
  )

  /**
   * Self-contained layer with an empty PTY environment overlay. Used by tests
   * and standalone servers; the full app provides a plugin-backed overlay via
   * `PluginPtyEnvironment.ptyLayer`.
   */
  export const defaultLayer = layer.pipe(Layer.provide(PtyEnvironment.defaultLayer))
}
