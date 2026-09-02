import { describe, expect, it } from "bun:test"
import { Config } from "@/config/config"
import { Policy } from "@/policy/policy"

function config(input: Partial<Config.Info>): Config.Info {
  // SAFETY: `Policy` reads only the handful of fields each test sets; the rest
  // of the config document is irrelevant to the rules under test.
  return input as Config.Info
}

describe("Policy", () => {
  it("allows by default", () => {
    expect(Policy.allows([], { action: "provider.use", resource: "anthropic" })).toBe(true)
  })

  it("uses the last matching statement", () => {
    const statements: Policy.Statement[] = [
      { effect: "deny", action: "provider.use", resource: "*" },
      { effect: "allow", action: "provider.use", resource: "anthropic" },
    ]

    expect(
      Policy.allows(statements, {
        action: "provider.use",
        resource: "anthropic",
      }),
    ).toBe(true)
    expect(Policy.allows(statements, { action: "provider.use", resource: "openai" })).toBe(false)
  })

  it("supports full and trailing prefix wildcards", () => {
    const statements: Policy.Statement[] = [{ effect: "deny", action: "provider.*", resource: "open*" }]

    expect(Policy.allows(statements, { action: "provider.use", resource: "openai" })).toBe(false)
    expect(
      Policy.allows(statements, {
        action: "provider.configure",
        resource: "openrouter",
      }),
    ).toBe(false)
    expect(
      Policy.allows(statements, {
        action: "plugin.load",
        resource: "openrouter",
      }),
    ).toBe(true)
  })

  it("translates a legacy allowlist without changing its behavior", () => {
    const value = config({ enabled_providers: ["anthropic", "openai"] })

    expect(Policy.allowsProvider(value, "anthropic")).toBe(true)
    expect(Policy.allowsProvider(value, "openai")).toBe(true)
    expect(Policy.allowsProvider(value, "google")).toBe(false)
  })

  it("keeps legacy denylist precedence over the allowlist", () => {
    const value = config({
      enabled_providers: ["anthropic"],
      disabled_providers: ["anthropic"],
    })

    expect(Policy.allowsProvider(value, "anthropic")).toBe(false)
  })

  it("lets explicit policy statements override translated legacy fields", () => {
    const value = config({
      disabled_providers: ["anthropic"],
      experimental: {
        policies: [{ effect: "allow", action: "provider.use", resource: "anthropic" }],
      },
    })

    expect(Policy.allowsProvider(value, "anthropic")).toBe(true)
  })

  it("filters a provider map the way listing surfaces should", () => {
    const value = config({ enabled_providers: ["anthropic"] })
    const providers = {
      anthropic: { id: "anthropic" },
      openai: { id: "openai" },
      google: { id: "google" },
    }

    expect(Policy.filter(value, providers)).toEqual({
      anthropic: { id: "anthropic" },
    })
  })
})

describe("Config.PolicyStatement", () => {
  it("accepts valid statements and rejects empty patterns", () => {
    const valid = {
      effect: "deny",
      action: "provider.use",
      resource: "open*",
    } satisfies Config.PolicyStatement

    expect(Config.PolicyStatement.parse(valid)).toEqual(valid)
    expect(Config.PolicyStatement.safeParse({ ...valid, action: "" }).success).toBe(false)
    expect(Config.PolicyStatement.safeParse({ ...valid, resource: "open*router" }).success).toBe(false)
  })
})
