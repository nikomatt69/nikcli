import { afterAll, describe, expect, it } from "bun:test"
import { recordBenchmark, flushBenchmarkRun } from "../benchmarks/runner"
import { Agent } from "../../src/agent/agent"

describe("Agent.Info schema", () => {
  const minimal = {
    name: "unit-test",
    mode: "primary" as const,
    permission: [] as { permission: string; pattern: string; action: "allow" | "deny" | "ask" }[],
    options: {},
  }

  it("parses a minimal valid agent", () => {
    const info = Agent.Info.parse(minimal)
    expect(info.name).toBe("unit-test")
    expect(info.mode).toBe("primary")
    expect(info.permission).toEqual([])
  })

  it("rejects invalid mode", () => {
    expect(() => Agent.Info.parse({ ...minimal, mode: "invalid" })).toThrow()
  })
})

describe("Agent.SUBAGENT_TOOLSETS", () => {
  it("exposes non-empty tool lists for subagent toolsets that define tools", () => {
    expect(Agent.SUBAGENT_TOOLSETS["fast-explore"].length).toBeGreaterThan(0)
    expect(Agent.SUBAGENT_TOOLSETS.explore).toContain("bash")
  })

  it("lists researcher tools including research-oriented entries", () => {
    const tools = Agent.SUBAGENT_TOOLSETS.researcher
    expect(tools).toContain("websearch")
    expect(tools).toContain("webfetch")
    // Was `docs_search` — a tool that never existed. See the drift guard in
    // test/tool/permission-surface.test.ts.
    expect(tools).toContain("memory_search")
  })

  it("lists scout repository research tools", () => {
    const tools = Agent.SUBAGENT_TOOLSETS.scout
    expect(tools).toContain("repo_clone")
    expect(tools).toContain("repo_overview")
    expect(tools).toContain("read")
  })
})

describe("Agent.Info parse benchmark", () => {
  it("records Agent.Info.parse hot path (pure validation)", () => {
    const minimal = {
      name: "bench",
      mode: "subagent" as const,
      permission: [
        { permission: "read", pattern: "*", action: "allow" as const },
        { permission: "bash", pattern: "*", action: "ask" as const },
      ],
      options: { foo: 1 },
    }
    const iterations = 8_000
    const start = performance.now()
    for (let i = 0; i < iterations; i += 1) {
      Agent.Info.parse({ ...minimal, name: `bench-${i % 3}` })
    }
    const elapsed = performance.now() - start
    recordBenchmark({
      suite: "agent",
      module: "schema",
      scenario: "Agent.Info.parse loop",
      iterations,
      value: elapsed,
      unit: "ms",
    })
    expect(elapsed).toBeGreaterThanOrEqual(0)
  })
})

afterAll(() => {
  return flushBenchmarkRun()
})
