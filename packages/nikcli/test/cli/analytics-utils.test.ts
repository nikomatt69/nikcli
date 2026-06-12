import { describe, expect, it } from "bun:test"
import {
  buildTabPrompt,
  buildTabTitle,
  formatCompact,
  formatDeltaPct,
  periodDelta,
  sampleForSparkline,
} from "../../src/cli/cmd/tui/util/analytics-utils"
import type { AggregatedStats, DayStats } from "../../src/cli/cmd/tui/util/analytics-aggregator"

// Minimal DayStats factory — the helpers under test only touch fields
// referenced by the selector (default `d.tokens`).
function day(date: string, fields: Partial<DayStats> = {}): DayStats {
  return {
    date,
    sessions: 0,
    tokens: 0,
    input: 0,
    output: 0,
    reasoning: 0,
    cacheRead: 0,
    cacheWrite: 0,
    cost: 0,
    messages: 0,
    models: new Map(),
    ...fields,
  }
}

function daysFrom(start: string, values: number[], key: "tokens" | "cost" | "messages" = "tokens"): DayStats[] {
  const startDate = new Date(`${start}T00:00:00.000Z`)
  return values.map((v, i) => {
    const d = new Date(startDate)
    d.setUTCDate(d.getUTCDate() + i)
    const isoDate = d.toISOString().split("T")[0]!
    const field = key === "cost" ? { cost: v } : key === "messages" ? { messages: v } : { tokens: v }
    return day(isoDate, field)
  })
}

describe("periodDelta", () => {
  it("returns zeros for empty input", () => {
    const d = periodDelta([], 7)
    expect(d.current).toBe(0)
    expect(d.previous).toBe(0)
    expect(d.absolute).toBe(0)
    expect(d.pct).toBe(0)
    expect(d.trend).toBe("flat")
  })

  it("returns flat trend when both windows sum to zero", () => {
    const d = periodDelta(daysFrom("2026-01-01", [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), 5)
    expect(d.current).toBe(0)
    expect(d.previous).toBe(0)
    expect(d.trend).toBe("flat")
    expect(d.pct).toBe(0)
  })

  it("computes pct change between two non-zero windows", () => {
    // current = sum of last 5 = 50, previous = sum of prior 5 = 100 → -50%
    const d = periodDelta(daysFrom("2026-01-01", [10, 10, 10, 10, 10, 10, 10, 10, 10, 10]), 5)
    expect(d.current).toBe(50)
    expect(d.previous).toBe(50)
    expect(d.absolute).toBe(0)
    expect(d.pct).toBe(0)
    expect(d.trend).toBe("flat")
  })

  it("reports up trend with positive pct", () => {
    // current = 5*20 = 100, previous = 5*10 = 50 → +100%
    const d = periodDelta(daysFrom("2026-01-01", [10, 10, 10, 10, 10, 20, 20, 20, 20, 20]), 5)
    expect(d.current).toBe(100)
    expect(d.previous).toBe(50)
    expect(d.absolute).toBe(50)
    expect(d.pct).toBe(100)
    expect(d.trend).toBe("up")
  })

  it("reports down trend with negative pct", () => {
    const d = periodDelta(daysFrom("2026-01-01", [20, 20, 20, 20, 20, 10, 10, 10, 10, 10]), 5)
    expect(d.current).toBe(50)
    expect(d.previous).toBe(100)
    expect(d.absolute).toBe(-50)
    expect(d.pct).toBe(-50)
    expect(d.trend).toBe("down")
  })

  it("falls back gracefully when history is shorter than 2*windowDays", () => {
    // Only 5 days; windowDays=7. previous window should be empty (0),
    // current window should aggregate all 5.
    const d = periodDelta(daysFrom("2026-01-01", [10, 20, 30, 40, 50]), 7)
    expect(d.current).toBe(150)
    expect(d.previous).toBe(0)
    expect(d.pct).toBe(Infinity) // 0 → +Inf (renders as "new")
  })

  it("uses the custom selector for the metric being summed", () => {
    const d = periodDelta(daysFrom("2026-01-01", [10, 20, 30, 40, 50, 60], "cost"), 3, (x) => x.cost)
    expect(d.current).toBe(60 + 50 + 40)
    expect(d.previous).toBe(30 + 20 + 10)
  })
})

describe("sampleForSparkline", () => {
  it("returns an array of zeros for empty input", () => {
    const out = sampleForSparkline([], 14)
    expect(out).toHaveLength(14)
    expect(out.every((v) => v === 0)).toBe(true)
  })

  it("returns an empty array for width 0", () => {
    expect(sampleForSparkline([1, 2, 3], 0)).toEqual([])
  })

  it("returns a copy when input length matches width", () => {
    const input = [1, 2, 3, 4, 5]
    const out = sampleForSparkline(input, 5)
    expect(out).toEqual([1, 2, 3, 4, 5])
    expect(out).not.toBe(input) // copy, not the same reference
  })

  it("downsamples via per-bucket max (preserves spikes)", () => {
    // 10 inputs → 2 output buckets. Each bucket is the max of its slice.
    // bucket 0: indices 0..4 (5 values: 1,2,3,4,5) → max = 5
    // bucket 1: indices 5..9 (5 values: 100,7,8,9,10) → max = 100
    const out = sampleForSparkline([1, 2, 3, 4, 5, 100, 7, 8, 9, 10], 2)
    expect(out).toEqual([5, 100])
  })

  it("upsamples via linear interpolation", () => {
    // 2 inputs → 5 output: endpoints are 1 and 5; midpoints interpolate.
    const out = sampleForSparkline([1, 5], 5)
    expect(out).toHaveLength(5)
    expect(out[0]).toBeCloseTo(1, 6)
    expect(out[4]).toBeCloseTo(5, 6)
    expect(out[2]).toBeCloseTo(3, 6) // midpoint
  })

  it("all-zero output when input is all zeros", () => {
    const out = sampleForSparkline([0, 0, 0, 0, 0], 3)
    expect(out).toEqual([0, 0, 0])
  })
})

describe("formatDeltaPct", () => {
  it("renders 0 as a neutral em-dash", () => {
    expect(formatDeltaPct(0)).toEqual({ text: "—", good: null })
  })

  it("renders positive pct with up arrow", () => {
    expect(formatDeltaPct(12.34)).toEqual({ text: "↑ 12.3%", good: true })
  })

  it("renders negative pct with down arrow", () => {
    expect(formatDeltaPct(-4.5)).toEqual({ text: "↓ 4.5%", good: false })
  })

  it("flips the good flag for inverse (cost, errors)", () => {
    expect(formatDeltaPct(20, true).good).toBe(false) // cost grew → bad
    expect(formatDeltaPct(-20, true).good).toBe(true) // cost dropped → good
  })

  it("renders +Infinity as 'new' (and -Infinity as '−new')", () => {
    expect(formatDeltaPct(Infinity)).toEqual({ text: "new", good: true })
    expect(formatDeltaPct(-Infinity)).toEqual({ text: "−new", good: false })
    expect(formatDeltaPct(Infinity, true)).toEqual({
      text: "new",
      good: false,
    })
  })
})

describe("formatCompact", () => {
  it("renders sub-1k numbers as plain integers", () => {
    expect(formatCompact(0)).toBe("0")
    expect(formatCompact(7)).toBe("7")
    expect(formatCompact(999)).toBe("999")
  })

  it("renders thousands with k suffix", () => {
    expect(formatCompact(1_000)).toBe("1.0k")
    expect(formatCompact(1_500)).toBe("1.5k")
    expect(formatCompact(12_345)).toBe("12k") // ≥10k collapses decimals
  })

  it("renders millions with M suffix", () => {
    expect(formatCompact(1_000_000)).toBe("1.0M")
    expect(formatCompact(2_500_000)).toBe("2.5M")
  })

  it("renders billions with B suffix", () => {
    expect(formatCompact(1_000_000_000)).toBe("1.00B")
  })

  it("preserves sign on negatives", () => {
    expect(formatCompact(-1_500)).toBe("-1.5k")
  })

  it("falls back to 0 for non-finite input", () => {
    expect(formatCompact(NaN)).toBe("0")
    expect(formatCompact(Infinity)).toBe("0")
  })
})

describe("buildTabTitle", () => {
  it("prefixes the tab title with the analytics group tag", () => {
    expect(buildTabTitle("overview")).toBe("Analytics · Activity overview")
    expect(buildTabTitle("tokens")).toBe("Analytics · Token usage breakdown")
    expect(buildTabTitle("models")).toBe("Analytics · Model usage comparison")
    expect(buildTabTitle("tools")).toBe("Analytics · Tool success / failure analysis")
    expect(buildTabTitle("projects")).toBe("Analytics · Project activity audit")
    expect(buildTabTitle("sessions")).toBe("Analytics · Session & background run review")
  })
})

describe("buildTabPrompt", () => {
  // Minimal but realistic AggregatedStats — only the fields the prompt
  // builder touches need to be populated.
  function makeStats(): AggregatedStats {
    return {
      global: {
        sessions: 12,
        archivedSessions: 3,
        messages: 240,
        tokens: {
          input: 100_000,
          output: 50_000,
          reasoning: 10_000,
          cacheRead: 25_000,
          cacheWrite: 5_000,
        },
        cost: 4.2,
        projects: [],
        workspaces: { total: 1, active: 1, disconnected: 0, byType: {} },
        backgroundRuns: {
          total: 6,
          running: 0,
          completed: 5,
          error: 1,
          cancelled: 0,
          successRate: 83.3,
          avgDuration: 12_000,
          topAgents: [],
        },
        toolUsage: { total: 100, tools: [], mostUsed: [] },
        todos: {
          total: 0,
          pending: 0,
          inProgress: 0,
          completed: 0,
          cancelled: 0,
          completionRate: 0,
          byPriority: [],
        },
        efficiency: {
          costPer1kTokens: 0.0263,
          costPerSession: 0.35,
          avgTokensPerSession: 13333,
          avgCostPerDay: 0.21,
        },
      },
      projects: [
        {
          id: "p1",
          name: "demo",
          vcs: "git",
          sessionCount: 5,
          workspaceCount: 1,
          totalCost: 1.2,
          totalTokens: 50_000,
          created: 1,
          lastActive: Date.now(),
        },
      ],
      workspaces: { total: 1, active: 1, disconnected: 0, byType: {} },
      sessions: [
        {
          sessionID: "s1",
          title: "Tune the renderer",
          directory: "/tmp",
          messages: 12,
          tokens: {
            input: 1000,
            output: 500,
            reasoning: 100,
            cacheRead: 0,
            cacheWrite: 0,
          },
          cost: 0.05,
          model: "gpt-4",
          provider: "openai",
          updated: 1,
          created: 1,
          duration: 1000,
        },
      ],
      providers: new Map([
        [
          "anthropic",
          {
            providerID: "anthropic",
            sessions: 8,
            messages: 200,
            tokens: {
              input: 80_000,
              output: 40_000,
              reasoning: 8_000,
              cache: 20_000,
            },
            cost: 3.5,
            models: new Set(["claude-3"]),
          },
        ],
      ]),
      models: [
        {
          key: "anthropic/claude-3",
          providerID: "anthropic",
          modelID: "claude-3",
          sessions: 8,
          messages: 200,
          tokens: {
            input: 80_000,
            output: 40_000,
            reasoning: 8_000,
            cacheRead: 20_000,
            cacheWrite: 5_000,
          },
          cost: 3.5,
          firstUsed: 1,
          lastUsed: Date.now(),
        },
      ],
      days: [
        {
          date: "2026-01-01",
          sessions: 1,
          tokens: 100,
          input: 0,
          output: 0,
          reasoning: 0,
          cacheRead: 0,
          cacheWrite: 0,
          cost: 0,
          messages: 0,
          models: new Map(),
        },
        {
          date: "2026-01-02",
          sessions: 1,
          tokens: 200,
          input: 0,
          output: 0,
          reasoning: 0,
          cacheRead: 0,
          cacheWrite: 0,
          cost: 0,
          messages: 0,
          models: new Map(),
        },
      ],
      backgroundRuns: {
        total: 6,
        running: 0,
        completed: 5,
        error: 1,
        cancelled: 0,
        successRate: 83.3,
        avgDuration: 12_000,
        topAgents: [],
      },
      toolUsage: {
        total: 100,
        tools: [
          { name: "bash", count: 60, successRate: 95 },
          { name: "read", count: 30, successRate: 65 },
        ],
        mostUsed: [
          { name: "bash", count: 60, successRate: 95 },
          { name: "read", count: 30, successRate: 65 },
        ],
      },
      todos: {
        total: 0,
        pending: 0,
        inProgress: 0,
        completed: 0,
        cancelled: 0,
        completionRate: 0,
        byPriority: [],
      },
    }
  }

  it("includes headline numbers and a directive for the overview tab", () => {
    const p = buildTabPrompt("overview", makeStats())
    expect(p).toContain("Total sessions: 12")
    expect(p).toContain("Total messages: 240")
    expect(p).toContain("Total non-cache tokens: 160.0k")
    expect(p).toContain("Total cost: $4.20")
    expect(p).toContain("anthropic ($3.50)")
    expect(p).toMatch(/Identify: \(1\)/)
  })

  it("includes efficiency + cache details for the tokens tab", () => {
    const p = buildTabPrompt("tokens", makeStats())
    expect(p).toContain("Cost per 1k tokens: $0.0263")
    expect(p).toContain("Avg cost per day: $0.21")
    // formatCompact collapses 25_000 → "25k" and 5_000 → "5.0k" (no decimal
    // when ≥10k, one decimal otherwise). We only assert on the more
    // diagnostic Cache line so the test is not coupled to that exact
    // rounding decision.
    expect(p).toMatch(/Cache savings: read 25k, write 5\.0k/)
    expect(p).toContain("Peak day in last 14")
    expect(p).toMatch(/Suggest: \(1\)/)
  })

  it("lists the top models with cost/usage for the models tab", () => {
    const p = buildTabPrompt("models", makeStats())
    // 128_000 tokens is ≥10k, so formatCompact renders it as "128k" (no
    // decimal). The test only asserts the round parts to stay robust.
    expect(p).toContain("claude-3 (anthropic): 128k tokens, $3.50, 200 msgs")
    expect(p).toMatch(/Recommend: \(1\)/)
  })

  it("flags failing tools in the tools tab prompt", () => {
    const p = buildTabPrompt("tools", makeStats())
    expect(p).toContain("Tools below 70% success: read")
    expect(p).toContain("bash: 60 calls, 95% success")
    expect(p).toMatch(/Identify: \(1\)/)
  })

  it("annotates project activity for the projects tab", () => {
    const p = buildTabPrompt("projects", makeStats())
    expect(p).toContain("Total projects: 1")
    expect(p).toContain("dormant >30d")
    expect(p).toMatch(/Recommend: \(1\)/)
  })

  it("summarizes sessions + background runs in the sessions tab", () => {
    const p = buildTabPrompt("sessions", makeStats())
    expect(p).toContain("Background runs: 6")
    expect(p).toContain("83% success")
    expect(p).toContain("Tune the renderer")
    expect(p).toMatch(/Highlight: \(1\)/)
  })
})
