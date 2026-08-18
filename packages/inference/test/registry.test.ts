import { describe, expect, it, beforeEach, afterEach } from "bun:test"
import { resetRegistryForTests, getRegistry } from "../src/providers/registry"

describe("ProviderRegistry", () => {
  const originalVllmBaseUrl = process.env.VLLM_BASE_URL

  beforeEach(() => {
    // The registry reads env in its constructor, so the endpoint has to be
    // cleared before the reset rather than after.
    delete process.env.VLLM_BASE_URL
    resetRegistryForTests()
  })

  afterEach(() => {
    if (originalVllmBaseUrl === undefined) delete process.env.VLLM_BASE_URL
    else process.env.VLLM_BASE_URL = originalVllmBaseUrl
    resetRegistryForTests()
  })

  it("registers the local provider but leaves it disabled without an endpoint", () => {
    const reg = getRegistry()
    expect(reg.isEnabled("local")).toBe(false)
    expect(reg.get("local")?.reason).toContain("missing env VLLM_BASE_URL")
    expect(reg.get("local")?.provider.name).toBe("local")
  })

  it("enables the local provider once VLLM_BASE_URL is configured", () => {
    process.env.VLLM_BASE_URL = "http://127.0.0.1:8000"
    const reg = resetRegistryForTests()
    expect(reg.isEnabled("local")).toBe(true)
    expect(reg.get("local")?.reason).toBeUndefined()
    expect(reg.enabled().find((p) => p.name === "local")).toBeDefined()
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
    expect(enabled.find((p) => p.name === "local")).toBeUndefined()
  })

  it("override swaps provider implementation", () => {
    const reg = getRegistry()
    const stub = { ...reg.get("local")!.provider, name: "stub" } as never
    reg.override("local", stub)
    expect(reg.get("local")?.provider.name).toBe("stub")
  })
})
