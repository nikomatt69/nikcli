import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { Config } from "../../config/config"
import { Auth } from "../../auth"
import { Instance } from "../../project/instance"
import { Provider } from "../../provider/provider"
import { ModelsDev } from "../../provider/models"
import { ProviderAuth } from "../../provider/auth"
import { mapValues } from "remeda"
import { errors } from "../error"
import { lazy } from "../../util/lazy"
import { Effect } from "effect"
import { runPromiseWithLayer, withCurrentInstance } from "@/effect"

function runProviderAuth<A, E>(effect: Effect.Effect<A, E, ProviderAuth.Service>) {
  return runPromiseWithLayer(ProviderAuth.defaultLayer, withCurrentInstance(effect))
}

function runAuth<A, E>(effect: Effect.Effect<A, E, Auth.Service>) {
  return runPromiseWithLayer(Auth.defaultLayer, effect)
}

function runConfig<A, E>(effect: Effect.Effect<A, E, Config.Service>) {
  return runPromiseWithLayer(Config.defaultLayer, withCurrentInstance(effect))
}

function runProvider<A, E>(effect: Effect.Effect<A, E, Provider.Service>) {
  return runPromiseWithLayer(Provider.defaultLayer, withCurrentInstance(effect))
}

// Invalidate the cached provider state after a credential change so the next
// `provider.list()` rebuilds from the updated `auth.json`. `Instance.dispose()`
// alone does not clear this cache, so without an explicit refresh a connected
// or disconnected provider would not show up until a CLI restart.
function refreshProviderCache() {
  return runProvider(
    Effect.gen(function* () {
      const provider = yield* Provider.Service
      yield* Effect.ignore(provider.refresh())
    }),
  )
}

export const ProviderRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "List providers",
        description: "Get a list of all available AI providers, including both available and connected ones.",
        operationId: "provider.list",
        responses: {
          200: {
            description: "List of providers",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    all: ModelsDev.Provider.array(),
                    default: z.record(z.string(), z.string()),
                    connected: z.array(z.string()),
                  }),
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        const config = await runConfig(
          Effect.gen(function* () {
            const service = yield* Config.Service
            return yield* service.get()
          }),
        )
        const disabled = new Set(config.disabled_providers ?? [])
        const enabled = config.enabled_providers ? new Set(config.enabled_providers) : undefined

        const allProviders = await ModelsDev.get()
        const filteredProviders: Record<string, (typeof allProviders)[string]> = {}
        for (const [key, value] of Object.entries(allProviders)) {
          if ((enabled ? enabled.has(key) : true) && !disabled.has(key)) {
            filteredProviders[key] = value
          }
        }

        const connected = await runProvider(
          Effect.gen(function* () {
            const provider = yield* Provider.Service
            return yield* provider.list()
          }),
        )
        const providers = Object.assign(
          mapValues(filteredProviders, (x) => Provider.fromModelsDevProvider(x)),
          connected,
        )
        return c.json({
          all: Object.values(providers),
          default: mapValues(providers, (item) => Provider.sort(Object.values(item.models))[0].id),
          connected: Object.keys(connected),
        })
      },
    )
    .get(
      "/auth",
      describeRoute({
        summary: "Get provider auth methods",
        description: "Retrieve available authentication methods for all AI providers.",
        operationId: "provider.auth",
        responses: {
          200: {
            description: "Provider auth methods",
            content: {
              "application/json": {
                schema: resolver(z.record(z.string(), z.array(ProviderAuth.Method))),
              },
            },
          },
        },
      }),
      async (c) => {
        const methods = await runProviderAuth(
          Effect.gen(function* () {
            const providerAuth = yield* ProviderAuth.Service
            return yield* providerAuth.methods()
          }),
        )
        return c.json(methods)
      },
    )
    .post(
      "/:providerID/api",
      describeRoute({
        summary: "Set provider API key",
        description: "Store an API key for a provider and refresh the current instance cache.",
        operationId: "provider.api.set",
        responses: {
          200: {
            description: "API key saved",
            content: {
              "application/json": {
                schema: resolver(z.object({ success: z.literal(true) })),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "param",
        z.object({
          providerID: z.string().meta({ description: "Provider ID" }),
        }),
      ),
      validator(
        "json",
        z.object({
          key: z.string().min(1).meta({ description: "Provider API key" }),
        }),
      ),
      async (c) => {
        const providerID = c.req.valid("param").providerID
        const { key } = c.req.valid("json")
        await runProviderAuth(
          Effect.gen(function* () {
            const providerAuth = yield* ProviderAuth.Service
            yield* providerAuth.api({ providerID, key })
          }),
        )
        await refreshProviderCache()
        await Instance.dispose()
        return c.json({ success: true as const })
      },
    )
    .delete(
      "/:providerID/auth",
      describeRoute({
        summary: "Remove provider credentials",
        description: "Remove stored credentials for a provider and refresh the current instance cache.",
        operationId: "provider.auth.remove",
        responses: {
          200: {
            description: "Credentials removed",
            content: {
              "application/json": {
                schema: resolver(z.object({ success: z.literal(true) })),
              },
            },
          },
        },
      }),
      validator(
        "param",
        z.object({
          providerID: z.string().meta({ description: "Provider ID" }),
        }),
      ),
      async (c) => {
        const providerID = c.req.valid("param").providerID
        await runAuth(
          Effect.gen(function* () {
            const auth = yield* Auth.Service
            yield* auth.remove(providerID)
          }),
        )
        await refreshProviderCache()
        await Instance.dispose()
        return c.json({ success: true as const })
      },
    )
    .post(
      "/:providerID/oauth/authorize",
      describeRoute({
        summary: "OAuth authorize",
        description: "Initiate OAuth authorization for a specific AI provider to get an authorization URL.",
        operationId: "provider.oauth.authorize",
        responses: {
          200: {
            description: "Authorization URL and method",
            content: {
              "application/json": {
                schema: resolver(ProviderAuth.Authorization.optional()),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "param",
        z.object({
          providerID: z.string().meta({ description: "Provider ID" }),
        }),
      ),
      validator(
        "json",
        z.object({
          method: z.number().meta({ description: "Auth method index" }),
        }),
      ),
      async (c) => {
        const providerID = c.req.valid("param").providerID
        const { method } = c.req.valid("json")
        const result = await runProviderAuth(
          Effect.gen(function* () {
            const providerAuth = yield* ProviderAuth.Service
            return yield* providerAuth.authorize({
              providerID,
              method,
            })
          }),
        )
        return c.json(result)
      },
    )
    .post(
      "/:providerID/oauth/callback",
      describeRoute({
        summary: "OAuth callback",
        description: "Handle the OAuth callback from a provider after user authorization.",
        operationId: "provider.oauth.callback",
        responses: {
          200: {
            description: "OAuth callback processed successfully",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "param",
        z.object({
          providerID: z.string().meta({ description: "Provider ID" }),
        }),
      ),
      validator(
        "json",
        z.object({
          method: z.number().meta({ description: "Auth method index" }),
          code: z.string().optional().meta({ description: "OAuth authorization code" }),
        }),
      ),
      async (c) => {
        const providerID = c.req.valid("param").providerID
        const { method, code } = c.req.valid("json")
        await runProviderAuth(
          Effect.gen(function* () {
            const providerAuth = yield* ProviderAuth.Service
            yield* providerAuth.callback({
              providerID,
              method,
              code,
            })
          }),
        )
        // OAuth stores credentials without disposing the instance, so the
        // provider cache must be refreshed here. Otherwise the just-connected
        // provider's models stay missing from the model picker until a CLI
        // restart.
        await refreshProviderCache()
        return c.json(true)
      },
    ),
)
