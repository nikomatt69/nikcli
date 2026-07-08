import { describe, expect, it } from "bun:test"
import { features } from "@/config/features"

describe("features()", () => {
  it("defaults all flags off", () => {
    expect(features(undefined)).toEqual({
      nativeLlm: false,
      tui: { cacheEviction: false, messageVirtualization: false },
      requests: { latestOnlyLspRefresh: false },
    })
    expect(features({})).toEqual({
      nativeLlm: false,
      tui: { cacheEviction: false, messageVirtualization: false },
      requests: { latestOnlyLspRefresh: false },
    })
  })

  it("reads experimental keys as true only when strictly true", () => {
    const f = features({
      experimental: {
        nativeLlm: true,
        tui: { cacheEviction: true, messageVirtualization: true },
        requests: { latestOnlyLspRefresh: true },
      },
    } as any)
    expect(f.nativeLlm).toBe(true)
    expect(f.tui.cacheEviction).toBe(true)
    expect(f.tui.messageVirtualization).toBe(true)
    expect(f.requests.latestOnlyLspRefresh).toBe(true)
  })

  it("treats truthy non-boolean as off", () => {
    const f = features({
      experimental: {
        nativeLlm: 1 as any,
        tui: { cacheEviction: "yes" as any },
      },
    } as any)
    expect(f.nativeLlm).toBe(false)
    expect(f.tui.cacheEviction).toBe(false)
  })
})
