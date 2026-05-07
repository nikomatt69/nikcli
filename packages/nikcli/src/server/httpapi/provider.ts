import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from "@effect/platform"
import { Effect, Layer, Schema } from "effect"
import { Auth } from "@/auth"
import { Config } from "@/config/config"
import { ModelsDev } from "@/provider/models"
import { ProviderAuth } from "@/provider/auth"
import { Provider } from "@/provider/provider"
import { Instance } from "@/project/instance"
import { mapValues } from "remeda"
import { ConfigHttpApi } from "./config"

export namespace ProviderHttpApi {
  const ProviderPath = Schema.Struct({
    providerID: Schema.String,
  })

  const ApiPayload = Schema.Struct({
    key: Schema.String,
  }).annotations({ identifier: "ProviderApiPayload" })

  const Success = Schema.Struct({
    success: Schema.Literal(true),
  }).annotations({ identifier: "ProviderMutationSuccess" })

  const Method = Schema.Struct({
    type: Schema.Literal("oauth", "api"),
    label: Schema.String,
  }).annotations({ identifier: "ProviderAuthMethod" })

  export const ListResponse = Schema.Struct({
    all: Schema.Array(ConfigHttpApi.ProviderInfo),
    default: Schema.Record({ key: Schema.String, value: Schema.String }),
    connected: Schema.Array(Schema.String),
  }).annotations({ identifier: "ProviderList" })

  export const AuthMethods = Schema.Record({ key: Schema.String, value: Schema.Array(Method) }).annotations({
    identifier: "ProviderAuthMethods",
  })

  export const Group = HttpApiGroup.make("provider")
    .add(HttpApiEndpoint.get("list", "/").addSuccess(ListResponse))
    .add(HttpApiEndpoint.get("auth", "/auth").addSuccess(AuthMethods))
    .add(HttpApiEndpoint.post("api", "/:providerID/api").setPath(ProviderPath).setPayload(ApiPayload).addSuccess(Success))
    .add(HttpApiEndpoint.del("removeAuth", "/:providerID/auth").setPath(ProviderPath).addSuccess(Success))
    .prefix("/provider")

  export const Api = HttpApi.make("nikcli").add(Group)

  export const ApiLive = HttpApiBuilder.api(Api)

  export const handlers = {
    list: () =>
      Effect.gen(function* () {
        const configService = yield* Config.Service
        const config = yield* configService.get()
        const disabled = new Set(config.disabled_providers ?? [])
        const enabled = config.enabled_providers ? new Set(config.enabled_providers) : undefined

        const allProviders = yield* Effect.promise(() => ModelsDev.get())
        const filteredProviders: Record<string, (typeof allProviders)[string]> = {}
        for (const [key, value] of Object.entries(allProviders)) {
          if ((enabled ? enabled.has(key) : true) && !disabled.has(key)) {
            filteredProviders[key] = value
          }
        }

        const provider = yield* Provider.Service
        const connected = yield* provider.list()
        const providers = Object.assign(
          mapValues(filteredProviders, (item) => Provider.fromModelsDevProvider(item)),
          connected,
        )

        return {
          all: Object.values(providers),
          default: mapValues(providers, (item) => Provider.sort(Object.values(item.models))[0].id),
          connected: Object.keys(connected),
        }
      }).pipe(Effect.orDie),
    auth: () =>
      Effect.gen(function* () {
        const providerAuth = yield* ProviderAuth.Service
        return yield* providerAuth.methods()
      }).pipe(Effect.orDie),
    api: ({ path, payload }: { path: { providerID: string }; payload: typeof ApiPayload.Type }) =>
      Effect.gen(function* () {
        const providerAuth = yield* ProviderAuth.Service
        yield* providerAuth.api({ providerID: path.providerID, key: payload.key })
        yield* Effect.promise(() => Instance.dispose())
        return { success: true as const }
      }).pipe(Effect.orDie),
    removeAuth: ({ path }: { path: { providerID: string } }) =>
      Effect.gen(function* () {
        const auth = yield* Auth.Service
        yield* auth.remove(path.providerID)
        yield* Effect.promise(() => Instance.dispose())
        return { success: true as const }
      }).pipe(Effect.orDie),
  }

  export const HandlersLive = HttpApiBuilder.group(Api, "provider", (builder) =>
    builder
      .handle("list", handlers.list)
      .handle("auth", handlers.auth)
      .handle("api", handlers.api)
      .handle("removeAuth", handlers.removeAuth),
  )

  export const DependenciesLive = Layer.mergeAll(
    Config.defaultLayer,
    Provider.defaultLayer,
    ProviderAuth.defaultLayer,
    Auth.defaultLayer,
  )

  export const layer = ApiLive.pipe(
    Layer.provide(HandlersLive),
    Layer.provide(DependenciesLive),
  )
}
