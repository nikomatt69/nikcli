/// <reference types="@types/bun" />

import { describe, expect, test } from "bun:test"
import {
  axisTicks,
  parseDownloads,
  queryGateway,
  summarize,
  usageWindows,
  SERIES_DAYS,
  WINDOW_DAYS,
  type DailyBucket,
  type UsageBucket,
} from "./publicStats"

const NOW = Date.UTC(2026, 7, 11) / 1000

function bucket(over: Partial<UsageBucket> & { model: string }): UsageBucket {
  return {
    provider: "anthropic",
    requests: 1,
    input_tokens: 0,
    output_tokens: 0,
    billed_usd: 0,
    saved_usd: 0,
    cache_hits: 0,
    cache_reported: 0,
    ...over,
  }
}

describe("summarize", () => {
  test("reports nothing rather than zeroes when the window has no rows", () => {
    expect(summarize([], [], [], NOW)).toBeNull()
    expect(summarize([bucket({ model: "sonnet" })], [], [], NOW)).toBeNull()
  })

  test("ranks models by tokens and shares add up to the whole window", () => {
    const stats = summarize(
      [
        bucket({ model: "haiku", input_tokens: 100, output_tokens: 100 }),
        bucket({ model: "sonnet", input_tokens: 600, output_tokens: 200 }),
      ],
      [],
      [],
      NOW,
    )!
    expect(stats.models.map((m) => m.model)).toEqual(["sonnet", "haiku"])
    expect(stats.totals.tokens).toBe(1000)
    expect(stats.models[0].share).toBeCloseTo(0.8)
    expect(stats.models.reduce((sum, m) => sum + m.share, 0)).toBeCloseTo(1)
  })

  test("sums a model that several providers served and names the dominant one", () => {
    const stats = summarize(
      [
        bucket({ model: "sonnet", provider: "bedrock", input_tokens: 100, requests: 2 }),
        bucket({ model: "sonnet", provider: "anthropic", input_tokens: 900, requests: 8 }),
      ],
      [],
      [],
      NOW,
    )!
    expect(stats.models).toHaveLength(1)
    expect(stats.models[0].tokens).toBe(1000)
    expect(stats.models[0].requests).toBe(10)
    expect(stats.models[0].provider).toBe("anthropic")
    expect(stats.providers.map((p) => p.provider)).toEqual(["anthropic", "bedrock"])
  })

  test("computes change against the previous window and leaves new models null", () => {
    const stats = summarize(
      [bucket({ model: "sonnet", input_tokens: 300 }), bucket({ model: "opus", input_tokens: 100 })],
      [bucket({ model: "sonnet", input_tokens: 100 })],
      [],
      NOW,
    )!
    const sonnet = stats.models.find((m) => m.model === "sonnet")!
    const opus = stats.models.find((m) => m.model === "opus")!
    expect(sonnet.change).toBeCloseTo(2) // 100 -> 300
    expect(opus.change).toBeNull()
    expect(stats.totals.change).toBeCloseTo(3) // 100 -> 400
  })

  test("derives per-request and per-million prices from what was actually billed", () => {
    const stats = summarize(
      [bucket({ model: "sonnet", input_tokens: 400_000, output_tokens: 600_000, billed_usd: 3, requests: 4 })],
      [],
      [],
      NOW,
    )!
    expect(stats.models[0].pricePerMillion).toBeCloseTo(3)
    expect(stats.models[0].costPerRequest).toBeCloseTo(0.75)
    expect(stats.models[0].tokensPerRequest).toBeCloseTo(250_000)
  })

  test("takes the cache ratio over reported requests only, and null when none reported", () => {
    const stats = summarize(
      [
        bucket({ model: "sonnet", input_tokens: 10, requests: 10, cache_hits: 6, cache_reported: 8 }),
        bucket({ model: "opus", input_tokens: 10, requests: 5 }),
      ],
      [],
      [],
      NOW,
    )!
    expect(stats.models.find((m) => m.model === "sonnet")!.cacheRatio).toBeCloseTo(0.75)
    expect(stats.models.find((m) => m.model === "opus")!.cacheRatio).toBeNull()
    expect(stats.totals.cacheRatio).toBeCloseTo(0.75)
  })

  test("reports cache-served rows separately instead of ranking them as a provider", () => {
    const stats = summarize(
      [
        bucket({ model: "sonnet", provider: null, input_tokens: 100 }),
        bucket({ model: "sonnet", provider: "anthropic", input_tokens: 50 }),
        bucket({ model: "sonnet", provider: "bedrock", input_tokens: 50 }),
      ],
      [],
      [],
      NOW,
    )!
    expect(stats.providers.map((p) => p.provider)).toEqual(["anthropic", "bedrock"])
    expect(stats.totals.cacheServedTokens).toBe(100)
    // Shares are taken over the tokens that reached an upstream, so they still
    // add up to the whole of what the providers actually served.
    expect(stats.providers.reduce((sum, p) => sum + p.share, 0)).toBeCloseTo(1)
    expect(stats.models[0].provider).toBeNull()
  })

  test("fills every day of the series window so a quiet day reads as a gap", () => {
    const daily: DailyBucket[] = [{ day: "2026-08-10", model: "sonnet", tokens: 500, requests: 5 }]
    const stats = summarize([bucket({ model: "sonnet", input_tokens: 500 })], [], daily, NOW)!
    expect(stats.series).toHaveLength(SERIES_DAYS + 1)
    expect(stats.series.at(-1)!.day).toBe("2026-08-11")
    const busy = stats.series.find((p) => p.day === "2026-08-10")!
    expect(busy.tokens).toBe(500)
    expect(stats.series.filter((p) => p.tokens === 0)).toHaveLength(SERIES_DAYS)
  })

  test("stacks the tail of the models into a single other band", () => {
    const models = Array.from({ length: 10 }, (_, i) => `model-${i}`)
    const current = models.map((model, i) => bucket({ model, input_tokens: (10 - i) * 100 }))
    const daily = models.map((model) => ({ day: "2026-08-10", model, tokens: 10, requests: 1 }))
    const stats = summarize(current, [], daily, NOW)!
    expect(stats.seriesModels.at(-1)).toBe("other")
    expect(stats.seriesModels.slice(0, -1)).toEqual(stats.models.slice(0, stats.seriesModels.length - 1).map((m) => m.model))
    // Every model the chart does not band individually lands in "other".
    const banded = stats.seriesModels.length - 1
    expect(stats.series.find((p) => p.day === "2026-08-10")!.byModel.other).toBe((models.length - banded) * 10)
  })
})

describe("usageWindows", () => {
  test("puts the comparison window immediately before the reported one, with no gap or overlap", () => {
    const { windowStart, previousStart, seriesStart } = usageWindows(NOW)
    const day = 86_400
    expect(NOW - windowStart).toBe(WINDOW_DAYS * day)
    expect(windowStart - previousStart).toBe(WINDOW_DAYS * day)
    expect(NOW - seriesStart).toBe(SERIES_DAYS * day)
  })
})

describe("queryGateway", () => {
  test("returns null without a binding instead of throwing on a public page", async () => {
    expect(await queryGateway(undefined, NOW)).toBeNull()
  })

  test("returns null when the database rejects, instead of failing the render", async () => {
    // Enough of a D1 binding for Drizzle to build on, and it always throws.
    const broken = {
      prepare: () => ({
        bind: () => ({
          all: () => Promise.reject(new Error("no such table: usage_events")),
          raw: () => Promise.reject(new Error("no such table: usage_events")),
        }),
      }),
    } as unknown as D1Database
    expect(await queryGateway(broken, NOW)).toBeNull()
  })
})

describe("axisTicks", () => {
  test("rounds the step up to a clean 1/2/5 number", () => {
    expect(axisTicks(1000)).toEqual([0, 250, 500, 750, 1000])
    expect(axisTicks(1700)).toEqual([0, 500, 1000, 1500, 2000])
    expect(axisTicks(3.4)).toEqual([0, 1, 2, 3, 4])
  })

  test("stops at the first tick that covers the data, not at a fixed count", () => {
    // 52,722 downloads: a 20K step covers it in three, so the axis does not
    // climb to 80K and leave a third of the plot empty.
    expect(axisTicks(52_722)).toEqual([0, 20_000, 40_000, 60_000])
  })

  test("never leaves more than one empty step above the data", () => {
    for (const max of [1, 7, 99, 512, 12_345, 52_722, 987_654_321]) {
      const ticks = axisTicks(max)
      const step = ticks[1] - ticks[0]
      expect(ticks[ticks.length - 1] - max).toBeLessThan(step)
    }
  })

  test("never clips the tallest mark", () => {
    for (const max of [1, 7, 99, 512, 12_345, 987_654_321]) {
      expect(axisTicks(max).at(-1)!).toBeGreaterThanOrEqual(max)
    }
  })

  test("still gives a usable axis for an empty chart", () => {
    expect(axisTicks(0)).toEqual([0, 1])
  })
})

describe("parseDownloads", () => {
  const md = `# Download Stats

| Date       | GitHub Downloads | npm Downloads    | Total            |
| ---------- | ---------------- | ---------------- | ---------------- |
| 2026-08-08 | 2,743 (+76)      | 48,656 (+2,328)  | 51,399 (+2,404)  |
| 2026-05-27 | 324 (+324)       | 3,772 (+3,772)   | 4,096 (+4,096)   |
`

  test("reads the real table, ignoring the header and separator rows", () => {
    const points = parseDownloads(md)
    expect(points).toHaveLength(2)
    expect(points[0]).toEqual({ date: "2026-05-27", github: 324, npm: 3772, total: 4096 })
  })

  test("recomputes the total instead of trusting a hand-edited one", () => {
    const wrong = `| 2026-08-08 | 100 (+1) | 200 (+2) | 999999 (+3) |`
    expect(parseDownloads(wrong)[0].total).toBe(300)
  })

  test("survives an empty or malformed log", () => {
    expect(parseDownloads("")).toEqual([])
    expect(parseDownloads("| not-a-date | x | y | z |")).toEqual([])
  })
})
