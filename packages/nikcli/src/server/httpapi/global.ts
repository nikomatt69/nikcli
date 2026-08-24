import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi"
import { Effect, Layer, Schema } from "effect"
import { BusEvent } from "@/bus/bus-event"
import { GlobalBus } from "@nikcli-ai/util/global-bus"
import { Installation } from "@/installation"
import { Instance } from "@/project/instance"
import { HttpApiAuth } from "./security"

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

  /**
   * Mixed group: `GET /global/health` is in `Auth.isPublicPath` (a liveness
   * probe has no credentials), so protection is declared per endpoint here
   * rather than on the whole group in `public.ts` (H8). Leaving `dispose`
   * unmarked would let a group-level sweep make the health probe claim a
   * security scheme it does not enforce.
   */
  export const Group = HttpApiGroup.make("global")
    .add(HttpApiEndpoint.get("health", "/health", { success: Health }))
    .add(HttpApiEndpoint.post("dispose", "/dispose", { success: Schema.Boolean }).middleware(HttpApiAuth.Middleware))
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
  ).pipe(
    // `dispose` declares the security middleware, so its implementation has to
    // be in scope while this group layer is built — `HttpApiBuilder.group`
    // resolves middleware out of the context it captures (H8). The served
    // surface composes its own `global` handlers in `public.ts`; this local
    // pair stays self-contained so it can still be built on its own.
    Layer.provide(HttpApiAuth.layer),
  )

  export const layer = ApiLive.pipe(Layer.provide(HandlersLive))
}
