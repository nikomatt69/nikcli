import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { InstanceState } from "@/effect"
import { zod, zodObjectMode } from "@/util/effect-zod"
import { Context, Effect, Layer, Schema } from "effect"
import z from "zod"

export namespace SessionStatus {
  // Legacy callers depend on `parse({type:"idle", extra: 1})` stripping unknown keys; the
  // walker defaults to `.strict()` which would throw, so opt each variant into "strip" mode.
  const strip = zodObjectMode("strip")
  const InfoSchema = Schema.Union(
    Schema.Struct({ type: Schema.Literal("idle") }).annotations(strip),
    Schema.Struct({
      type: Schema.Literal("retry"),
      attempt: Schema.Number,
      message: Schema.String,
      next: Schema.Number,
    }).annotations(strip),
    Schema.Struct({ type: Schema.Literal("busy") }).annotations(strip),
  ).annotations({ identifier: "SessionStatus" })
  export const Info = zod(InfoSchema)
  export type Info = Schema.Schema.Type<typeof InfoSchema>

  export const Event = {
    Status: BusEvent.define(
      "session.status",
      z.object({
        sessionID: z.string(),
        status: Info,
      }),
    ),
    // deprecated
    Idle: BusEvent.define(
      "session.idle",
      z.object({
        sessionID: z.string(),
      }),
    ),
  }

  const state = InstanceState.make<Record<string, Info>>(() => Effect.succeed({}))

  export class Service extends Context.Tag("SessionStatus.Service")<
    Service,
    {
      get(sessionID: string): Effect.Effect<Info>
      list(): Effect.Effect<Record<string, Info>>
      set(sessionID: string, status: Info): Effect.Effect<void>
      hydrate(sessionID: string, status: Info): Effect.Effect<void>
    }
  >() {}

  export const layer = Layer.scoped(
    Service,
    Effect.gen(function* () {
      const cache = yield* state
      return Service.of({
        get(sessionID) {
          return InstanceState.get(cache).pipe(
            Effect.map(
              (statuses) =>
              statuses[sessionID] ?? {
                type: "idle" as const,
              },
            ),
          )
        },
        list() {
          return InstanceState.get(cache)
        },
        set(sessionID, status) {
          return InstanceState.get(cache).pipe(Effect.map((statuses) => {
            Bus.publish(Event.Status, {
              sessionID,
              status,
            })
            if (status.type === "idle") {
              // deprecated
              Bus.publish(Event.Idle, {
                sessionID,
              })
              delete statuses[sessionID]
              return
            }
            statuses[sessionID] = status
          }))
        },
        hydrate(sessionID, status) {
          return InstanceState.get(cache).pipe(Effect.map((statuses) => {
            if (status.type === "idle") {
              delete statuses[sessionID]
              return
            }
            statuses[sessionID] = status
          }))
        },
      })
    }),
  )

  export const defaultLayer = layer
}
