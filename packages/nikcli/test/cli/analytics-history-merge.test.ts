import { describe, expect, it } from "bun:test"
import {
  aggregateAnalytics,
  mergeWithHistorical,
  type HistoricalDailyData,
  type HistoricalGlobalData,
} from "@tui/util/analytics-aggregator"

// The analytics panel merges three payloads into one aggregate: the live sync
// pass, GET /analytics/global and GET /analytics/daily. `tools` on the daily
// payload was declared on the type and read by nobody, so the Tools tab only
// ever showed the tool calls of the session that happened to be open — every
// other day of history was fetched and thrown away.

function emptyLive() {
  return aggregateAnalytics({
    session: [],
    message: {},
    part: {},
    todo: {},
    workspaceList: [],
    background_job: {},
  })
}

function historicalGlobal(): HistoricalGlobalData {
  return {
    version: 1,
    updatedAt: 0,
    totals: {
      sessions: 12,
      messages: 40,
      tokens: { input: 100, output: 20, reasoning: 5, cacheRead: 0, cacheWrite: 0 },
      cost: 1.5,
      toolCalls: 21,
    },
    byProvider: {},
    byModel: {},
    byProject: {},
  }
}

function day(date: string, tools: HistoricalDailyData["tools"]): HistoricalDailyData {
  return {
    date,
    sessions: 1,
    messages: 2,
    tokens: { input: 10, output: 5, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
    cost: 0.1,
    toolCalls: Object.values(tools).reduce((sum, tool) => sum + tool.calls, 0),
    tools,
    providers: {},
    models: {},
    recordedAt: 0,
  }
}

describe("mergeWithHistorical tool usage", () => {
  it("sums the per-tool breakdown across every day in the window", () => {
    const merged = mergeWithHistorical(emptyLive(), {
      global: historicalGlobal(),
      daily: [
        day("2026-08-01", {
          bash: { calls: 6, success: 6, error: 0 },
          read: { calls: 2, success: 1, error: 1 },
        }),
        day("2026-08-02", {
          bash: { calls: 4, success: 3, error: 1 },
          edit: { calls: 3, success: 3, error: 0 },
        }),
      ],
    })

    // Ranked by call count, not by the day they first appeared.
    expect(merged.toolUsage.tools.map((tool) => tool.name)).toEqual(["bash", "edit", "read"])
    expect(merged.toolUsage.total).toBe(15)

    const bash = merged.toolUsage.tools.find((tool) => tool.name === "bash")!
    expect(bash.count).toBe(10)
    expect(bash.successRate).toBeCloseTo(90)

    const read = merged.toolUsage.tools.find((tool) => tool.name === "read")!
    expect(read.count).toBe(2)
    expect(read.successRate).toBeCloseTo(50)

    // The tab reads global.toolUsage in some places and the top-level field in
    // others; both have to carry the merged list.
    expect(merged.global.toolUsage).toEqual(merged.toolUsage)
    expect(merged.toolUsage.mostUsed).toEqual(merged.toolUsage.tools.slice(0, 10))
  })

  it("keeps the live pass when history reports no tools at all", () => {
    const live = emptyLive()
    const merged = mergeWithHistorical(live, {
      global: historicalGlobal(),
      daily: [day("2026-08-01", {})],
    })
    expect(merged.toolUsage).toEqual(live.toolUsage)
  })

  it("does not double count a day the live pass already saw", () => {
    const live = emptyLive()
    // The daily window always includes today, so history is a superset of the
    // live pass rather than something to add on top of it.
    live.toolUsage = {
      total: 6,
      tools: [{ name: "bash", count: 6, successRate: 100 }],
      mostUsed: [{ name: "bash", count: 6, successRate: 100 }],
    }

    const merged = mergeWithHistorical(live, {
      global: historicalGlobal(),
      daily: [day("2026-08-01", { bash: { calls: 6, success: 6, error: 0 } })],
    })

    expect(merged.toolUsage.tools).toEqual([{ name: "bash", count: 6, successRate: 100 }])
    expect(merged.toolUsage.total).toBe(6)
  })

  it("still surfaces a tool only the live pass has seen", () => {
    const live = emptyLive()
    live.toolUsage = {
      total: 1,
      tools: [{ name: "webfetch", count: 1, successRate: 100 }],
      mostUsed: [{ name: "webfetch", count: 1, successRate: 100 }],
    }

    const merged = mergeWithHistorical(live, {
      global: historicalGlobal(),
      daily: [day("2026-08-01", { bash: { calls: 3, success: 3, error: 0 } })],
    })

    expect(merged.toolUsage.tools.map((tool) => tool.name)).toEqual(["bash", "webfetch"])
    expect(merged.toolUsage.total).toBe(4)
  })
})
