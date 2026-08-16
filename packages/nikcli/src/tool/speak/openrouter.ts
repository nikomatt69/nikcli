import { Effect } from "effect"
import { OpenRouterProvider as OpenRouterBase } from "@nikcli-ai/util/tts/openrouter"
import { runPromiseWithLayer, withCurrentInstance } from "@/effect"

const BASE_URL = "https://openrouter.ai/api/v1"

/**
 * The provider as the server has it: the same synthesis, one more place to look
 * for a key.
 *
 * The catalog, the request shape and the streaming decode moved to
 * `@nikcli-ai/util/tts/openrouter` so the terminal can list voices and audio
 * models — the only two things it ever asks for — without importing `Auth`,
 * `Config` and the Effect runtime. What could not move is this lookup, and it
 * is the whole difference between the two.
 *
 * Precedence is unchanged: env, then `auth.json`, then `provider.openrouter.options`.
 */
export class OpenRouterServerProvider extends OpenRouterBase {
  protected override async resolveCredentials() {
    // Lazily imported: this file is reachable from the tool registry, and the
    // config chain is heavy enough that pulling it in at module load costs
    // every command that never speaks.
    const { Config } = await import("@/config/config")
    const { Auth } = await import("@/auth")

    const auth = await runPromiseWithLayer(
      Auth.defaultLayer,
      Effect.gen(function* () {
        const auth = yield* Auth.Service
        return yield* auth.get("openrouter")
      }),
    )
    const config = await runPromiseWithLayer(
      Config.defaultLayer,
      withCurrentInstance(
        Effect.gen(function* () {
          const config = yield* Config.Service
          return yield* config.get()
        }),
      ),
    ).catch(() =>
      // No instance bound (a global command, or the tool running outside a
      // project): the global document still carries the provider options.
      runPromiseWithLayer(
        Config.defaultLayer,
        Effect.gen(function* () {
          const config = yield* Config.Service
          return yield* config.getGlobal()
        }),
      ).catch(() => ({}) as any),
    )

    const providerOptions = config?.provider?.openrouter?.options ?? {}
    const fromProviderOptions = typeof providerOptions.apiKey === "string" ? providerOptions.apiKey : undefined

    return {
      apiKey:
        process.env.NIKCLI_OPENROUTER_API_KEY ??
        process.env.OPENROUTER_API_KEY ??
        (auth?.type === "api" ? auth.key : undefined) ??
        fromProviderOptions,
      baseURL:
        process.env.NIKCLI_OPENROUTER_BASE_URL ??
        (typeof providerOptions.baseURL === "string" ? providerOptions.baseURL : BASE_URL),
    }
  }
}

export const openRouterProvider = new OpenRouterServerProvider()
