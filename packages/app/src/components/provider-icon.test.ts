import { describe, expect, it } from "bun:test"
import { resolveProviderIcon } from "@nikcli-ai/ui/provider-icon"

describe("resolveProviderIcon", () => {
  it("keeps exact provider icons", () => {
    expect(resolveProviderIcon("minimax")).toBe("minimax")
    expect(resolveProviderIcon("zai-coding-plan")).toBe("zai-coding-plan")
  })

  it("uses the provider brand for plan and enterprise variants", () => {
    expect(resolveProviderIcon("minimax-coding-plan")).toBe("minimax")
    expect(resolveProviderIcon("minimax-cn-coding-plan")).toBe("minimax-cn")
    expect(resolveProviderIcon("alibaba-coding-plan-cn")).toBe("alibaba-cn")
    expect(resolveProviderIcon("xiaomi-token-plan-sgp")).toBe("xiaomi")
    expect(resolveProviderIcon("github-copilot-enterprise")).toBe("github-copilot")
  })

  it("supports known provider aliases and unknown custom providers", () => {
    expect(resolveProviderIcon("ollama")).toBe("ollama-cloud")
    expect(resolveProviderIcon("nikcli-inference")).toBe("nikcli")
    expect(resolveProviderIcon("custom-provider")).toBe("synthetic")
  })
})
