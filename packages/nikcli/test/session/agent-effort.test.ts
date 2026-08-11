import { describe, expect, it } from "bun:test"
import { Config } from "@/config/config"

// `effort` is the cheapest cost lever the provider exposes and nikcli sent it
// on no request at all: unset means the provider's own default, which is its
// deepest setting. So a subagent that greps a directory and reports what it
// found was paying the same depth as the agent designing the change.
//
// The wiring is one line in `session/llm.ts`; what is worth pinning is the
// contract around it, because both halves are easy to break silently.
describe("agent effort", () => {
  it("accepts the depths the provider accepts, and nothing else", () => {
    for (const effort of ["low", "medium", "high", "max"]) {
      expect(Config.Agent.safeParse({ effort }).success).toBe(true)
    }
    // Not in this provider's enum. Allowing it would produce a request the
    // provider rejects, which is worse than rejecting it here.
    expect(Config.Agent.safeParse({ effort: "xhigh" }).success).toBe(false)
    expect(Config.Agent.safeParse({ effort: "none" }).success).toBe(false)
  })

  it("stays optional, so an agent that says nothing keeps the provider default", () => {
    const parsed = Config.Agent.safeParse({})
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.effort).toBeUndefined()
  })

  it("is carried on the same object as the other per-agent model settings", () => {
    // `temperature` and `top_p` already live here; `effort` belongs beside them
    // rather than in a parallel place, or the two drift.
    const parsed = Config.Agent.safeParse({ effort: "low", temperature: 0.2, model: "anthropic/claude-sonnet-5" })
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.effort).toBe("low")
      expect(parsed.data.temperature).toBe(0.2)
    }
  })
})
