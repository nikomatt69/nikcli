import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from "@effect/platform"
import { Effect, Layer, Schema } from "effect"
import { Config } from "@/config/config"
import { Instance } from "@/project/instance"
import { Provider } from "@/provider/provider"
import { mapValues } from "remeda"

export namespace ConfigHttpApi {
  export const Info = Schema.Record({ key: Schema.String, value: Schema.Unknown }).annotations({ identifier: "Config" })

  const Model = Schema.Struct({
    id: Schema.String,
    providerID: Schema.optional(Schema.String),
    name: Schema.String,
    family: Schema.optional(Schema.String),
    cost: Schema.optional(Schema.Unknown),
    limit: Schema.optional(Schema.Unknown),
    api: Schema.optional(Schema.Unknown),
    status: Schema.optional(Schema.String),
    options: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
    headers: Schema.Record({ key: Schema.String, value: Schema.String }),
    release_date: Schema.String,
    variants: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
  })

  export const ProviderInfo = Schema.Struct({
    id: Schema.String,
    name: Schema.String,
    source: Schema.Literal("env", "config", "custom", "api"),
    env: Schema.Array(Schema.String),
    key: Schema.optional(Schema.String),
    options: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
    models: Schema.Record({ key: Schema.String, value: Model }),
  }).annotations({ identifier: "Provider" })

  export const ProviderSummary = Schema.Struct({
    providers: Schema.Array(ProviderInfo),
    default: Schema.Record({ key: Schema.String, value: Schema.String }),
  }).annotations({ identifier: "ConfigProviders" })

  export const Group = HttpApiGroup.make("config")
    .add(HttpApiEndpoint.get("get", "/").addSuccess(Info))
    .add(HttpApiEndpoint.patch("update", "/").setPayload(Info).addSuccess(Info))
    .add(HttpApiEndpoint.get("providers", "/providers").addSuccess(ProviderSummary))
    .prefix("/config")

  export const Api = HttpApi.make("nikcli").add(Group)

  export const ApiLive = HttpApiBuilder.api(Api)

  export const handlers = {
    get: () =>
      Effect.gen(function* () {
        const config = yield* Config.Service
        return yield* config.get()
      }).pipe(Effect.orDie),
    update: ({ payload }: { payload: typeof Info.Type }) =>
      Effect.gen(function* () {
        const config = yield* Config.Service
        yield* config.update(payload as Config.Info)
        yield* Effect.promise(() => Instance.dispose())
        return payload
      }).pipe(Effect.orDie),
    providers: () =>
      Effect.gen(function* () {
        const provider = yield* Provider.Service
        const providers = yield* provider.list()
        return {
          providers: Object.values(providers),
          default: mapValues(providers, (item) => Provider.sort(Object.values(item.models))[0].id),
        }
      }).pipe(Effect.orDie),
  }

  export const HandlersLive = HttpApiBuilder.group(Api, "config", (builder) =>
    builder
      .handle("get", handlers.get)
      .handle("update", handlers.update)
      .handle("providers", handlers.providers),
  )

  export const DependenciesLive = Layer.mergeAll(Config.defaultLayer, Provider.defaultLayer)

  export const layer = ApiLive.pipe(
    Layer.provide(HandlersLive),
    Layer.provide(DependenciesLive),
  )
}
