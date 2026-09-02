import { InstanceState } from "@/effect"
import { Plugin } from "../plugin"
import { map, filter, pipe, fromEntries, mapValues } from "remeda"
import type { AuthOuathResult, Hooks } from "@nikcli-ai/plugin"
import { Auth } from "@/auth"
import { zodObject } from "@nikcli-ai/util/effect-zod"
import { Context, Effect, Layer, Schema } from "effect"

export namespace ProviderAuth {
  const MethodSchema = Schema.Struct({
    type: Schema.Literals(["oauth", "api"]),
    label: Schema.String,
  }).annotate({ identifier: "ProviderAuthMethod" })
  export const Method = zodObject(MethodSchema)
  export type Method = Schema.Schema.Type<typeof MethodSchema>

  const AuthorizationSchema = Schema.Struct({
    url: Schema.String,
    method: Schema.Literals(["auto", "code", "auto-code"]),
    instructions: Schema.String,
  }).annotate({ identifier: "ProviderAuthAuthorization" })
  export const Authorization = zodObject(AuthorizationSchema)
  export type Authorization = Schema.Schema.Type<typeof AuthorizationSchema>

  const AuthorizeInputSchema = Schema.Struct({
    providerID: Schema.String,
    method: Schema.Number,
  })
  const AuthorizeInput = zodObject(AuthorizeInputSchema)
  export type AuthorizeInput = Schema.Schema.Type<typeof AuthorizeInputSchema>

  const CallbackInputSchema = Schema.Struct({
    providerID: Schema.String,
    method: Schema.Number,
    code: Schema.optional(Schema.String),
  })
  const CallbackInput = zodObject(CallbackInputSchema)
  export type CallbackInput = Schema.Schema.Type<typeof CallbackInputSchema>

  const ApiInputSchema = Schema.Struct({
    providerID: Schema.String,
    key: Schema.String,
  })
  const ApiInput = zodObject(ApiInputSchema)
  export type ApiInput = Schema.Schema.Type<typeof ApiInputSchema>

  type State = {
    methods: Record<string, Hooks["auth"] & { provider: string }>
    pending: Record<string, AuthOuathResult>
  }

  export interface Interface {
    readonly methods: () => Effect.Effect<Record<string, Method[]>>
    readonly authorize: (input: AuthorizeInput) => Effect.Effect<Authorization | undefined>
    readonly callback: (input: CallbackInput) => Effect.Effect<void, unknown>
    readonly api: (input: ApiInput) => Effect.Effect<void, unknown>
  }

  export class Service extends Context.Service<Service, Interface>()("@nikcli/ProviderAuth") {}

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const state = yield* InstanceState.make<State>(() =>
        Effect.gen(function* () {
          const plugins = yield* Effect.provide(
            Effect.gen(function* () {
              const plugin = yield* Plugin.Service
              return yield* plugin.list()
            }),
            Plugin.defaultLayer,
          )
          const methods = pipe(
            plugins,
            filter((x) => x.auth?.provider !== undefined),
            map((x) => [x.auth!.provider, x.auth!] as const),
            fromEntries(),
          )
          return { methods, pending: {} }
        }).pipe(Effect.orDie),
      )

      const getState = () => InstanceState.get(state)
      const authService = yield* Auth.Service

      const methods = Effect.fn("ProviderAuth.methods")(function* () {
        const s = yield* getState()
        return mapValues(s.methods, (x) =>
          x.methods.map(
            (y): Method => ({
              type: y.type,
              label: y.label,
            }),
          ),
        )
      })

      const authorize = Effect.fn("ProviderAuth.authorize")(function* (input: AuthorizeInput) {
        const parsed = AuthorizeInput.parse(input)
        const s = yield* getState()
        const auth = s.methods[parsed.providerID]
        const method = auth.methods[parsed.method]
        if (method.type !== "oauth") return undefined
        const result = yield* Effect.promise(() => method.authorize())
        s.pending[parsed.providerID] = result
        return {
          url: result.url,
          method: result.method,
          instructions: result.instructions,
        }
      })

      const callback = Effect.fn("ProviderAuth.callback")(function* (input: CallbackInput) {
        const parsed = CallbackInput.parse(input)
        const s = yield* getState()
        const match = s.pending[parsed.providerID]
        if (!match) return yield* Effect.fail(new OauthMissing({ providerID: parsed.providerID }))
        let result

        if (match.method === "code") {
          const code = parsed.code
          if (!code) return yield* Effect.fail(new OauthCodeMissing({ providerID: parsed.providerID }))
          result = yield* Effect.promise(() => match.callback(code))
        }

        if (match.method === "auto") {
          result = yield* Effect.promise(() => match.callback())
        }

        if (match.method === "auto-code") {
          result = yield* Effect.promise(() => match.callback(parsed.code))
        }

        if (result?.type === "success") {
          if ("key" in result) {
            yield* authService.set(parsed.providerID, {
              type: "api",
              key: result.key,
            })
          }
          if ("refresh" in result) {
            const oauth = {
              type: "oauth",
              access: result.access,
              refresh: result.refresh,
              expires: result.expires,
            } as const
            const info: Auth.Info = result.accountId ? { ...oauth, accountId: result.accountId } : oauth
            yield* authService.set(parsed.providerID, info)
          }
          return
        }

        return yield* Effect.fail(new OauthCallbackFailed({}))
      })

      const api = Effect.fn("ProviderAuth.api")(function* (input: ApiInput) {
        const parsed = ApiInput.parse(input)
        yield* authService.set(parsed.providerID, {
          type: "api",
          key: parsed.key,
        })
      })

      return Service.of({
        methods,
        authorize,
        callback,
        api,
      })
    }),
  ).pipe(Layer.provide(Auth.defaultLayer))

  export const defaultLayer = layer

  export class OauthMissing extends Schema.TaggedError<OauthMissing>()("ProviderAuthOauthMissing", {
    providerID: Schema.String,
  }) {}
  export class OauthCodeMissing extends Schema.TaggedError<OauthCodeMissing>()("ProviderAuthOauthCodeMissing", {
    providerID: Schema.String,
  }) {}
  export class OauthCallbackFailed extends Schema.TaggedError<OauthCallbackFailed>()(
    "ProviderAuthOauthCallbackFailed",
    {},
  ) {}
}
