import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Effect, Layer, Schema } from "effect"
import { Auth } from "@/auth"
import { Config } from "@/config/config"
import { ModelsDev } from "@/provider/models"
import { ProviderAuth } from "@/provider/auth"
import { Provider } from "@/provider/provider"
import { Instance } from "@/project/instance"
import { mapValues } from "remeda"
import { ConfigHttpApi } from "./config"
import { Policy } from "@/policy/policy"

export namespace ProviderHttpApi {
  const ProviderPath = Schema.Struct({
    providerID: Schema.String,
  })

  const ApiPayload = Schema.Struct({
    key: Schema.String,
  }).annotate({ identifier: "ProviderApiPayload" })

  const Success = Schema.Struct({
    success: Schema.Literal(true),
  }).annotate({ identifier: "ProviderMutationSuccess" })

  const Method = Schema.Struct({
    type: Schema.Literals(["oauth", "api"]),
    label: Schema.String,
  }).annotate({ identifier: "ProviderAuthMethod" })

  export const ListResponse = Schema.Struct({
    all: Schema.Array(ConfigHttpApi.ProviderInfo),
    default: Schema.Record(Schema.String, Schema.String),
    connected: Schema.Array(Schema.String),
  }).annotate({ identifier: "ProviderList" })

  export const AuthMethods = Schema.Record(Schema.String, Schema.Array(Method)).annotate({
    identifier: "ProviderAuthMethods",
  })

  const Authorization = Schema.Struct({
    url: Schema.String,
    method: Schema.Literals(["auto", "code", "auto-code"]),
    instructions: Schema.String,
  }).annotate({ identifier: "ProviderOAuthAuthorization" })
  /** `authorize` yields undefined for providers without an OAuth flow — encoded as JSON null. */
  const AuthorizeResponse = Schema.NullOr(Authorization)
  const AuthorizePayload = Schema.Struct({
    method: Schema.Number,
  }).annotate({ identifier: "ProviderOAuthAuthorizeInput" })
  const CallbackPayload = Schema.Struct({
    method: Schema.Number,
    code: Schema.optional(Schema.String),
  }).annotate({ identifier: "ProviderOAuthCallbackInput" })

  // Provider payloads contain model metadata (e.g. cost.experimentalOver200K) that may
  // be `undefined`. Effect HttpApi rejects `undefined` JSON values, so we normalize via
  // JSON.stringify (which strips those keys) before returning.
  const jsonSafe = <T>(value: T): T => JSON.parse(JSON.stringify(value ?? null)) as T

  export const Group = HttpApiGroup.make("provider")
    .add(HttpApiEndpoint.get("list", "/", { success: ListResponse }))
    .add(HttpApiEndpoint.get("auth", "/auth", { success: AuthMethods }))
    .add(
      HttpApiEndpoint.post("api", "/:providerID/api", {
        params: ProviderPath,
        payload: ApiPayload,
        success: Success,
      }).annotate(OpenApi.Identifier, "provider.api.set"),
    )
    .add(
      HttpApiEndpoint.delete("removeAuth", "/:providerID/auth", {
        params: ProviderPath,
        success: Success,
      }).annotate(OpenApi.Identifier, "provider.auth.remove"),
    )
    .add(
      HttpApiEndpoint.post("oauthAuthorize", "/:providerID/oauth/authorize", {
        params: ProviderPath,
        payload: AuthorizePayload,
        success: AuthorizeResponse,
      }).annotate(OpenApi.Identifier, "provider.oauth.authorize"),
    )
    .add(
      HttpApiEndpoint.post("oauthCallback", "/:providerID/oauth/callback", {
        params: ProviderPath,
        payload: CallbackPayload,
        success: Schema.Boolean,
      }).annotate(OpenApi.Identifier, "provider.oauth.callback"),
    )
    .prefix("/provider")

  export const Api = HttpApi.make("nikcli").add(Group)

  export const ApiLive = HttpApiBuilder.layer(Api)

  export const handlers = {
    list: () =>
      Effect.gen(function* () {
        const configService = yield* Config.Service
        const config = yield* configService.get()

        const filteredProviders = Policy.filter(config, yield* Effect.promise(() => ModelsDev.get()))

        const provider = yield* Provider.Service
        const connected = yield* provider.list()
        const providers = Object.assign(
          mapValues(filteredProviders, (item) => Provider.fromModelsDevProvider(item)),
          connected,
        )

        return jsonSafe({
          all: Object.values(providers),
          default: mapValues(providers, (item) => Provider.sort(Object.values(item.models))[0].id),
          connected: Object.keys(connected),
        })
      }).pipe(Effect.orDie),
    auth: () =>
      Effect.gen(function* () {
        const providerAuth = yield* ProviderAuth.Service
        const methods = yield* providerAuth.methods()
        return jsonSafe(methods)
      }).pipe(Effect.orDie),
    api: ({ params, payload }: { params: { providerID: string }; payload: typeof ApiPayload.Type }) =>
      Effect.gen(function* () {
        const providerAuth = yield* ProviderAuth.Service
        yield* providerAuth.api({
          providerID: params.providerID,
          key: payload.key,
        })
        yield* Effect.promise(() => Instance.dispose())
        const provider = yield* Provider.Service
        yield* Effect.ignore(provider.refresh())
        return { success: true as const }
      }).pipe(Effect.orDie),
    removeAuth: ({ params }: { params: { providerID: string } }) =>
      Effect.gen(function* () {
        const auth = yield* Auth.Service
        yield* auth.remove(params.providerID)
        yield* Effect.promise(() => Instance.dispose())
        const provider = yield* Provider.Service
        yield* Effect.ignore(provider.refresh())
        return { success: true as const }
      }).pipe(Effect.orDie),
    oauthAuthorize: ({ params, payload }: { params: { providerID: string }; payload: { method: number } }) =>
      Effect.gen(function* () {
        const providerAuth = yield* ProviderAuth.Service
        const result = yield* providerAuth.authorize({
          providerID: params.providerID,
          method: payload.method,
        })
        return jsonSafe(result ?? null)
      }).pipe(Effect.orDie),
    oauthCallback: ({
      params,
      payload,
    }: {
      params: { providerID: string }
      payload: { method: number; code?: string }
    }) =>
      Effect.gen(function* () {
        const providerAuth = yield* ProviderAuth.Service
        yield* providerAuth.callback({
          providerID: params.providerID,
          method: payload.method,
          code: payload.code,
        })
        // OAuth stores credentials without disposing the instance, so the
        // provider cache must be refreshed here — otherwise the
        // just-connected provider's models stay missing until a restart.
        const provider = yield* Provider.Service
        yield* Effect.ignore(provider.refresh())
        return true
      }).pipe(Effect.orDie),
  }

  export const HandlersLive = HttpApiBuilder.group(Api, "provider", (builder) =>
    builder
      .handle("list", handlers.list)
      .handle("auth", handlers.auth)
      .handle("api", handlers.api)
      .handle("removeAuth", handlers.removeAuth)
      .handle("oauthAuthorize", handlers.oauthAuthorize)
      .handle("oauthCallback", handlers.oauthCallback),
  )

  export const DependenciesLive = Layer.mergeAll(
    Config.defaultLayer,
    Provider.defaultLayer,
    ProviderAuth.defaultLayer,
    Auth.defaultLayer,
  )

  export const layer = ApiLive.pipe(Layer.provide(HandlersLive), Layer.provide(DependenciesLive))
}
