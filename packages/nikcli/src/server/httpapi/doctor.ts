import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi"
import { Effect, Layer, Schema } from "effect"
import { runDoctorChecks } from "@/cli/cmd/doctor"
import { Installation } from "@/installation"

export namespace DoctorHttpApi {
  const Check = Schema.Struct({
    ok: Schema.Boolean,
    label: Schema.String,
    detail: Schema.optional(Schema.String),
    fix: Schema.optional(Schema.String),
  }).annotate({ identifier: "DoctorCheck" })

  const Report = Schema.Struct({
    ok: Schema.Boolean,
    version: Schema.String,
    channel: Schema.String,
    failures: Schema.Number,
    results: Schema.Array(Check),
  }).annotate({ identifier: "DoctorReport" })

  export const Group = HttpApiGroup.make("doctor")
    .add(HttpApiEndpoint.get("run", "/", { success: Report }))
    .prefix("/doctor")

  export const Api = HttpApi.make("nikcli").add(Group)

  export const ApiLive = HttpApiBuilder.layer(Api)

  export const handlers = {
    run: () =>
      Effect.gen(function* () {
        const { ok, results } = yield* Effect.promise(() => runDoctorChecks())
        return {
          ok,
          version: Installation.VERSION,
          channel: Installation.CHANNEL,
          failures: results.filter((r) => !r.ok).length,
          results,
        }
      }).pipe(Effect.orDie),
  }

  export const HandlersLive = HttpApiBuilder.group(Api, "doctor", (builder) =>
    builder.handle("run", () => handlers.run()),
  )

  /**
   * `runDoctorChecks` reads `$PATH`, the local config file, and the runtime
   * environment; it does not depend on any Effect service. The layer is kept
   * (empty) to mirror the rest of the public API surface — adding a service
   * later will not change `public.ts`.
   */
  export const DependenciesLive = Layer.empty

  export const layer = ApiLive.pipe(Layer.provide(HandlersLive), Layer.provide(DependenciesLive))
}
