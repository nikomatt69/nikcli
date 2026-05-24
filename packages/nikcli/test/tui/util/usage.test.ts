import { describe, expect, it } from "bun:test"
import { Usage } from "@/cli/cmd/tui/util/usage"
import { recordBenchmark, compareBenchmarkRuns } from "../../benchmarks/runner"

describe("Usage.formatTokens", () => {
  it("returns plain number for values below 1000", () => {
    expect(Usage.formatTokens(0)).toBe("0")
    expect(Usage.formatTokens(1)).toBe("1")
    expect(Usage.formatTokens(999)).toBe("999")
  })

  it("formats 1000-9999 with one decimal and k", () => {
    expect(Usage.formatTokens(1000)).toBe("1.0k")
    expect(Usage.formatTokens(1500)).toBe("1.5k")
    expect(Usage.formatTokens(9999)).toBe("10.0k")
  })

  it("formats 10000-999999 without decimal and with k", () => {
    expect(Usage.formatTokens(10000)).toBe("10k")
    expect(Usage.formatTokens(50000)).toBe("50k")
    expect(Usage.formatTokens(999999)).toBe("1000k")
  })

  it("formats 1000000-9999999 with one decimal and m", () => {
    expect(Usage.formatTokens(1000000)).toBe("1.0m")
    expect(Usage.formatTokens(2500000)).toBe("2.5m")
  })

  it("formats 10000000+ without decimal and with m", () => {
    expect(Usage.formatTokens(10000000)).toBe("10m")
    expect(Usage.formatTokens(100000000)).toBe("100m")
  })
})

describe("Usage.formatPct", () => {
  it("returns — for zero total", () => {
    expect(Usage.formatPct(100, 0)).toBe("—")
    expect(Usage.formatPct(0, 0)).toBe("—")
  })

  it("returns — for negative total", () => {
    expect(Usage.formatPct(5, -1)).toBe("—")
  })

  it("returns value with 1 decimal for pct < 10", () => {
    expect(Usage.formatPct(1, 100)).toBe("1.0%")
    expect(Usage.formatPct(5, 100)).toBe("5.0%")
    expect(Usage.formatPct(9, 100)).toBe("9.0%")
  })

  it("returns value without decimal for pct >= 10", () => {
    expect(Usage.formatPct(10, 100)).toBe("10%")
    expect(Usage.formatPct(50, 100)).toBe("50%")
    expect(Usage.formatPct(100, 100)).toBe("100%")
  })

  it("handles pct over 100%", () => {
    const result = Usage.formatPct(150, 100)
    expect(result).toBe("150%")
  })
})

describe("Usage.fromMessages", () => {
  const noMessages = () => Usage.fromMessages(undefined, [])

  it("returns zero usage for undefined messages", () => {
    const usage = noMessages()
    expect(usage.tokens).toBe(0)
    expect(usage.cost).toBe(0)
    expect(usage.components.input).toBe(0)
    expect(usage.components.output).toBe(0)
    expect(usage.autocompactReserved).toBe(0)
  })

  it("returns zero usage for empty messages array", () => {
    const usage = Usage.fromMessages([], [])
    expect(usage.tokens).toBe(0)
    expect(usage.cost).toBe(0)
  })

  it("returns zero usage when no assistant messages with output tokens", () => {
    const messages: any[] = [{ id: "m1", role: "user" }]
    const usage = Usage.fromMessages(messages, [])
    expect(usage.tokens).toBe(0)
  })

  it("extracts token counts from last assistant message", () => {
    const messages: any[] = [
      {
        id: "m1",
        role: "assistant",
        tokens: { input: 100, output: 50, reasoning: 10, cache: { read: 20, write: 5 }, total: 0 },
        cost: 0.01,
        providerID: "minimax-coding-plan",
        modelID: "MiniMax-M2.7",
      },
    ]
    const usage = Usage.fromMessages(messages, [])
    expect(usage.components.input).toBe(100)
    expect(usage.components.output).toBe(50)
    expect(usage.components.reasoning).toBe(10)
    expect(usage.components.cacheRead).toBe(20)
    expect(usage.components.cacheWrite).toBe(5)
  })

  it("uses total tokens if available and > 0", () => {
    const messages: any[] = [
      {
        id: "m1",
        role: "assistant",
        tokens: { input: 100, output: 50, reasoning: 10, cache: { read: 20, write: 5 }, total: 200 },
        cost: 0,
        providerID: "p",
        modelID: "m",
      },
    ]
    const usage = Usage.fromMessages(messages, [])
    expect(usage.tokens).toBe(200)
  })

  it("sums cost across all assistant messages", () => {
    const messages: any[] = [
      {
        id: "m1",
        role: "assistant",
        tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 }, total: 0 },
        cost: 0.01,
        providerID: "p",
        modelID: "m",
      },
      {
        id: "m2",
        role: "assistant",
        tokens: { input: 200, output: 100, reasoning: 0, cache: { read: 0, write: 0 }, total: 0 },
        cost: 0.02,
        providerID: "p",
        modelID: "m",
      },
    ]
    const usage = Usage.fromMessages(messages, [])
    expect(usage.cost).toBeCloseTo(0.03)
  })

  it("resolves model info from providers", () => {
    const providers: any[] = [
      {
        id: "minimax-coding-plan",
        models: {
          "MiniMax-M2.7": {
            name: "MiniMax-M2.7",
            limit: { input: 200000, context: 200000, output: 4000 },
          },
        },
      },
    ]
    const messages: any[] = [
      {
        id: "m1",
        role: "assistant",
        tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 }, total: 150 },
        cost: 0,
        providerID: "minimax-coding-plan",
        modelID: "MiniMax-M2.7",
      },
    ]
    const usage = Usage.fromMessages(messages, providers)
    expect(usage.model).toBeDefined()
    expect(usage.model?.name).toBe("MiniMax-M2.7")
    expect(usage.percent).toBeDefined()
    expect(usage.free).toBeDefined()
  })

  describe("benchmark", () => {
    it("Usage.formatTokens throughput", () => {
      const values = [0, 500, 1500, 50000, 1500000, 15000000]
      let i = 0
      recordBenchmark({
        suite: "tui-usage",
        module: "Usage.formatTokens",
        scenario: "throughput",
        iterations: 500_000,
        value: Usage.formatTokens(values[i++ % values.length]!) as unknown as number,
        unit: "ms",
      })
    })

    it("Usage.formatPct throughput", () => {
      recordBenchmark({
        suite: "tui-usage",
        module: "Usage.formatPct",
        scenario: "throughput",
        iterations: 500_000,
        value: Usage.formatPct(42, 200) as unknown as number,
        unit: "ms",
      })
    })

    it("Usage.fromMessages throughput", () => {
      const messages: any[] = [
        {
          id: "m1",
          role: "assistant",
          tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 }, total: 150 },
          cost: 0.01,
          providerID: "minimax-coding-plan",
          modelID: "MiniMax-M2.7",
        },
      ]
      recordBenchmark({
        suite: "tui-usage",
        module: "Usage.fromMessages",
        scenario: "throughput",
        iterations: 100_000,
        value: Usage.fromMessages(messages, []) as unknown as number,
        unit: "ms",
      })
    })
  })
})
