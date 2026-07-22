import type { BaseProvider } from "./index"
import { LocalProvider } from "./index"
import { OpenAICompatProvider, PROVIDER_DEFS, type ProviderName } from "./openai-compat"

export interface RegisteredProvider {
  name: ProviderName
  enabled: boolean
  reason?: string
  provider: BaseProvider
}

class ProviderRegistry {
  private readonly map = new Map<ProviderName, RegisteredProvider>()

  constructor() {
    this.bootstrap()
  }

  private bootstrap() {
    // Local vLLM is a fallback only when an endpoint was configured explicitly:
    // claiming it is enabled on a host with no vLLM turns every fallback into
    // an "Unable to connect" 500.
    const localConfigured = Boolean(process.env.VLLM_BASE_URL)
    this.map.set("local", {
      name: "local",
      enabled: localConfigured,
      reason: localConfigured ? undefined : "missing env VLLM_BASE_URL",
      provider: new LocalProvider(),
    })

    for (const [name, def] of Object.entries(PROVIDER_DEFS) as [ProviderName, (typeof PROVIDER_DEFS)[ProviderName]][]) {
      if (name === "local") continue
      const apiKey = process.env[def.envKey]
      if (!apiKey) {
        this.map.set(name, {
          name,
          enabled: false,
          reason: `missing env ${def.envKey}`,
          provider: new OpenAICompatProvider(def, ""),
        })
        continue
      }
      this.map.set(name, {
        name,
        enabled: true,
        provider: new OpenAICompatProvider(def, apiKey),
      })
    }
  }

  get(name: ProviderName): RegisteredProvider | undefined {
    return this.map.get(name)
  }

  isEnabled(name: ProviderName): boolean {
    return this.map.get(name)?.enabled ?? false
  }

  list(): RegisteredProvider[] {
    return Array.from(this.map.values())
  }

  enabled(): RegisteredProvider[] {
    return this.list().filter((p) => p.enabled)
  }

  /** Replace the provider implementation for a name (test seam). */
  override(name: ProviderName, provider: BaseProvider) {
    const existing = this.map.get(name)
    this.map.set(name, {
      name,
      enabled: true,
      provider,
      reason: existing?.reason,
    })
  }
}

let singleton: ProviderRegistry | null = null

export function getRegistry(): ProviderRegistry {
  if (!singleton) singleton = new ProviderRegistry()
  return singleton
}

export function resetRegistryForTests(): ProviderRegistry {
  singleton = new ProviderRegistry()
  return singleton
}

export type { ProviderName }
