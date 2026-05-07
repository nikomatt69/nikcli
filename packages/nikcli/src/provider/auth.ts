import { InstanceState } from "@/effect"
import { Plugin } from "../plugin"
import { map, filter, pipe, fromEntries, mapValues } from "remeda"
import z from "zod"
import type { AuthOuathResult, Hooks } from "@nikcli-ai/plugin"
import { NamedError } from "@nikcli-ai/util/error"
import { Auth } from "@/auth"
import { Context, Effect, Layer } from "effect"

export namespace ProviderAuth {
  export const Method = z
    .object({
      type: z.union([z.literal("oauth"), z.literal("api")]),
      label: z.string(),
    })
    .meta({
      ref: "ProviderAuthMethod",
  })
  export type Method = z.infer<typeof Method>

  export const Authorization = z
    .object({
      url: z.string(),
      method: z.union([z.literal("auto"), z.literal("code")]),
      instructions: z.string(),
    })
    .meta({
      ref: "ProviderAuthAuthorization",
  })
  export type Authorization = z.infer<typeof Authorization>

  const AuthorizeInput = z.object({
    providerID: z.string(),
    method: z.number(),
  })
  export type AuthorizeInput = z.infer<typeof AuthorizeInput>

  const CallbackInput = z.object({
    providerID: z.string(),
    method: z.number(),
    code: z.string().optional(),
  })
  export type CallbackInput = z.infer<typeof CallbackInput>

  const ApiInput = z.object({
    providerID: z.string(),
    key: z.string(),
  })
  export type ApiInput = z.infer<typeof ApiInput>

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

  export class Service extends Context.Tag("@nikcli/ProviderAuth")<Service, Interface>() {}

  export const layer = Layer.scoped(
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

        if (result?.type === "success") {
          if ("key" in result) {
            yield* authService.set(parsed.providerID, {
              type: "api",
              key: result.key,
            })
          }
          if ("refresh" in result) {
            const info: Auth.Info = {
              type: "oauth",
              access: result.access,
              refresh: result.refresh,
              expires: result.expires,
            }
            if (result.accountId) {
              info.accountId = result.accountId
            }
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

  export const OauthMissing = NamedError.create(
    "ProviderAuthOauthMissing",
    z.object({
      providerID: z.string(),
    }),
  )
  export const OauthCodeMissing = NamedError.create(
    "ProviderAuthOauthCodeMissing",
    z.object({
      providerID: z.string(),
    }),
  )

  export const OauthCallbackFailed = NamedError.create("ProviderAuthOauthCallbackFailed", z.object({}))
}
