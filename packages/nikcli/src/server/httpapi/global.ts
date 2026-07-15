import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi"
import { Effect, Layer, Schema } from "effect"
import z from "zod"
import { BusEvent } from "@/bus/bus-event"
import { GlobalBus } from "@/bus/global"
import { Installation } from "@/installation"
import { Instance } from "@/project/instance"

/**
 * Single definition shared with the legacy Hono `routes/global.ts` handler —
 * `BusEvent.define` must run once per event type, so the Hono route imports
 * this constant instead of defining its own.
 */
export const GlobalDisposedEvent = BusEvent.schema("global.disposed", Schema.Struct({}))

/**
 * Global (instance-less) JSON routes for the Effect backend: `/global/health`
 * and `/global/dispose`. These are served by the bridge WITHOUT instance
 * context — `/global` is mounted before the instance/workspace middleware in
 * `server.ts`, so handlers here must never read `InstanceRef`.
 *
 * `GET /global/event` stays a raw SSE response (`HttpApiEvent.handle`), same
 * as top-level `GET /event`.
 */
export namespace GlobalHttpApi {
  const Health = Schema.Struct({
    healthy: Schema.Literal(true),
    version: Schema.String,
  }).annotate({ identifier: "GlobalHealth" })

  export const Group = HttpApiGroup.make("global")
    .add(HttpApiEndpoint.get("health", "/health", { success: Health }))
    .add(HttpApiEndpoint.post("dispose", "/dispose", { success: Schema.Boolean }))
    .prefix("/global")

  export const Api = HttpApi.make("nikcli").add(Group)
  export const ApiLive = HttpApiBuilder.layer(Api)

  export const handlers = {
    health: () =>
      Effect.succeed({
        healthy: true as const,
        version: Installation.VERSION,
      }),

    dispose: () =>
      Effect.promise(() => Instance.disposeAll()).pipe(
        Effect.map(() => {
          GlobalBus.emit("event", {
            directory: "global",
            payload: {
              type: GlobalDisposedEvent.type,
              properties: {},
            },
          })
          return true
        }),
        Effect.orDie,
      ),
  }

  export const HandlersLive = HttpApiBuilder.group(Api, "global", (builder) =>
    builder.handle("health", handlers.health).handle("dispose", handlers.dispose),
  )

  export const layer = ApiLive.pipe(Layer.provide(HandlersLive))
}
