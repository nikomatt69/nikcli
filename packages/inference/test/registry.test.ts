import { describe, expect, it, beforeEach } from "bun:test"
import { resetRegistryForTests, getRegistry } from "../src/providers/registry"

describe("ProviderRegistry", () => {
  beforeEach(() => {
    resetRegistryForTests()
  })

  it("registers local provider as enabled by default", () => {
    const reg = getRegistry()
    expect(reg.isEnabled("local")).toBe(true)
    expect(reg.get("local")?.provider.name).toBe("local")
  })

  it("disables providers with no env key", () => {
    const reg = getRegistry()
    expect(reg.isEnabled("groq")).toBe(false)
    expect(reg.get("groq")?.reason).toContain("missing env GROQ_API_KEY")
  })

  it("enabled() returns only enabled providers", () => {
    const reg = getRegistry()
    const enabled = reg.enabled()
    expect(enabled.every((p) => p.enabled)).toBe(true)
    expect(enabled.find((p) => p.name === "local")).toBeDefined()
  })

  it("override swaps provider implementation", () => {
    const reg = getRegistry()
    const stub = { ...reg.get("local")!.provider, name: "stub" } as never
    reg.override("local", stub)
    expect(reg.get("local")?.provider.name).toBe("stub")
  })
})
