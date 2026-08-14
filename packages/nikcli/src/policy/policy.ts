import type { Config } from "@/config/config"

export namespace Policy {
  export type Effect = "allow" | "deny"

  export type Statement = {
    effect: Effect
    action: string
    resource: string
  }

  export type Input = {
    action: string
    resource: string
  }

  function matches(pattern: string, value: string) {
    if (pattern === "*") return true
    if (!pattern.endsWith("*")) return pattern === value
    return value.startsWith(pattern.slice(0, -1))
  }

  export function legacyProviderStatements(config: Pick<Config.Info, "enabled_providers" | "disabled_providers">) {
    const statements: Statement[] = []
    if (config.enabled_providers) {
      statements.push({
        effect: "deny",
        action: "provider.use",
        resource: "*",
      })
      for (const providerID of config.enabled_providers) {
        statements.push({
          effect: "allow",
          action: "provider.use",
          resource: providerID,
        })
      }
    }
    for (const providerID of config.disabled_providers ?? []) {
      statements.push({
        effect: "deny",
        action: "provider.use",
        resource: providerID,
      })
    }
    return statements
  }

  export function statements(config: Config.Info): Statement[] {
    return [...legacyProviderStatements(config), ...(config.experimental?.policies ?? [])]
  }

  export function allows(statements: readonly Statement[], input: Input) {
    let allowed = true
    for (const statement of statements) {
      if (!matches(statement.action, input.action)) continue
      if (!matches(statement.resource, input.resource)) continue
      allowed = statement.effect === "allow"
    }
    return allowed
  }

  export function allowsProvider(config: Config.Info, providerID: string) {
    return allows(statements(config), {
      action: "provider.use",
      resource: providerID,
    })
  }

  /**
   * Keep the providers the catalog would show. HTTP, auth, and session listing
   * call this instead of re-deriving enabled/disabled membership.
   */
  export function filter<T>(config: Config.Info, providers: Record<string, T>): Record<string, T> {
    const policy = statements(config)
    const filtered: Record<string, T> = {}
    for (const [key, value] of Object.entries(providers)) {
      if (allows(policy, { action: "provider.use", resource: key })) {
        filtered[key] = value
      }
    }
    return filtered
  }
}
