import { describe, expect, it, beforeEach } from "bun:test"
import { resetRegistryForTests, getRegistry } from "../src/providers/registry"

describe("ProviderRegistry", () => {
  beforeEach(() => {
    resetRegistryForTests()
  })

  it("disables local provider by default when VLLM_BASE_URL is absent", () => {
    delete process.env.VLLM_BASE_URL
    resetRegistryForTests()
    const reg = getRegistry()
    expect(reg.isEnabled("local")).toBe(false)
    expect(reg.get("local")?.reason).toContain("missing env VLLM_BASE_URL")
  })

  it("registers local provider as enabled when VLLM_BASE_URL is set", () => {
    process.env.VLLM_BASE_URL = "http://localhost:8000/v1"
    try {
      resetRegistryForTests()
      const reg = getRegistry()
      expect(reg.isEnabled("local")).toBe(true)
      expect(reg.get("local")?.provider.name).toBe("local")
    } finally {
      delete process.env.VLLM_BASE_URL
      resetRegistryForTests()
    }
  })

  it("disables providers with no env key", () => {
    delete process.env.VLLM_BASE_URL
    resetRegistryForTests()
    const reg = getRegistry()
    expect(reg.isEnabled("groq")).toBe(false)
    expect(reg.get("groq")?.reason).toContain("missing env GROQ_API_KEY")
  })

  it("enabled() returns only enabled providers", () => {
    process.env.VLLM_BASE_URL = "http://localhost:8000/v1"
    try {
      resetRegistryForTests()
      const reg = getRegistry()
      const enabled = reg.enabled()
      expect(enabled.every((p) => p.enabled)).toBe(true)
      expect(enabled.find((p) => p.name === "local")).toBeDefined()
    } finally {
      delete process.env.VLLM_BASE_URL
      resetRegistryForTests()
    }
  })

  it("override swaps provider implementation", () => {
    const reg = getRegistry()
    const stub = { ...reg.get("local")!.provider, name: "stub" } as never
    reg.override("local", stub)
    expect(reg.get("local")?.provider.name).toBe("stub")
  })
})
