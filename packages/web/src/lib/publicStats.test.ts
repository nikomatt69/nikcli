/// <reference types="@types/bun" />

import { describe, expect, test } from "bun:test"
import {
  ACTIVITY_DAYS,
  axisTicks,
  fetchCommunity,
  fetchGateway,
  parseDownloads,
  summarize,
  summarizeCommunity,
  SERIES_DAYS,
  type UsageBucket,
} from "./publicStats"

const NOW = Date.UTC(2026, 7, 11) / 1000
const DAY = 86_400

function bucket(over: Partial<UsageBucket> & { model: string }): UsageBucket {
  return {
    provider: "anthropic",
    requests: 1,
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: 0,
    ...over,
  }
}

/** A feed of the shape packages/console/app/src/routes/data.json.ts publishes. */
function feed(over: Record<string, unknown> = {}) {
  return {
    generatedAt: NOW,
    windowDays: 30,
    seriesDays: SERIES_DAYS,
    activityDays: ACTIVITY_DAYS,
    current: [],
    previous: [],
    daily: [],
    activity: [],
    ...over,
  }
}

describe("summarize", () => {
  test("reports nothing rather than zeroes when the window has no rows", () => {
    expect(summarize(feed(), NOW)).toBeNull()
    expect(summarize(feed({ current: [bucket({ model: "sonnet" })] }), NOW)).toBeNull()
  })

  test("degrades to nothing rather than to a page of NaN when the feed is not what we expect", () => {
    expect(summarize(null, NOW)).toBeNull()
    expect(summarize("nope", NOW)).toBeNull()
    expect(summarize({ current: "not-an-array" }, NOW)).toBeNull()
  })

  test("counts every kind of token the gateway bills for", () => {
    const stats = summarize(
      feed({
        current: [
          bucket({
            model: "sonnet",
            inputTokens: 100,
            outputTokens: 10,
            reasoningTokens: 5,
            cacheReadTokens: 800,
            cacheWriteTokens: 85,
          }),
        ],
      }),
      NOW,
    )!
    expect(stats.totals.tokens).toBe(1000)
  })

  test("ranks models by tokens and shares add up to the whole window", () => {
    const stats = summarize(
      feed({
        current: [
          bucket({ model: "haiku", inputTokens: 200 }),
          bucket({ model: "sonnet", inputTokens: 600, outputTokens: 200 }),
        ],
      }),
      NOW,
    )!
    expect(stats.models.map((m) => m.model)).toEqual(["sonnet", "haiku"])
    expect(stats.models[0].share).toBeCloseTo(0.8)
    expect(stats.models.reduce((sum, m) => sum + m.share, 0)).toBeCloseTo(1)
  })

  test("sums a model that several providers served and names the dominant one", () => {
    const stats = summarize(
      feed({
        current: [
          bucket({ model: "sonnet", provider: "bedrock", inputTokens: 100, requests: 2 }),
          bucket({ model: "sonnet", provider: "anthropic", inputTokens: 900, requests: 8 }),
        ],
      }),
      NOW,
    )!
    expect(stats.models).toHaveLength(1)
    expect(stats.models[0].tokens).toBe(1000)
    expect(stats.models[0].requests).toBe(10)
    expect(stats.models[0].provider).toBe("anthropic")
    expect(stats.providers.map((p) => p.provider)).toEqual(["anthropic", "bedrock"])
    expect(stats.providers.reduce((sum, p) => sum + p.share, 0)).toBeCloseTo(1)
  })

  test("computes change against the previous window and leaves new models null", () => {
    const stats = summarize(
      feed({
        current: [bucket({ model: "sonnet", inputTokens: 300 }), bucket({ model: "opus", inputTokens: 100 })],
        previous: [bucket({ model: "sonnet", inputTokens: 100 })],
      }),
      NOW,
    )!
    expect(stats.models.find((m) => m.model === "sonnet")!.change).toBeCloseTo(2) // 100 -> 300
    expect(stats.models.find((m) => m.model === "opus")!.change).toBeNull()
    expect(stats.totals.change).toBeCloseTo(3) // 100 -> 400
  })

  test("derives per-completion and per-million prices from what was actually billed", () => {
    const stats = summarize(
      feed({
        current: [bucket({ model: "sonnet", inputTokens: 400_000, outputTokens: 600_000, costUsd: 3, requests: 4 })],
      }),
      NOW,
    )!
    expect(stats.models[0].pricePerMillion).toBeCloseTo(3)
    expect(stats.models[0].costPerRequest).toBeCloseTo(0.75)
    expect(stats.models[0].tokensPerRequest).toBeCloseTo(250_000)
  })

  test("takes the cache ratio over input tokens only, since output is never cached", () => {
    const stats = summarize(
      feed({
        current: [
          bucket({ model: "sonnet", inputTokens: 100, outputTokens: 900, cacheReadTokens: 300 }),
          bucket({ model: "opus", outputTokens: 500 }),
        ],
      }),
      NOW,
    )!
    // 300 cached of 400 readable — the 900 output tokens do not dilute it.
    expect(stats.models.find((m) => m.model === "sonnet")!.cacheRatio).toBeCloseTo(0.75)
    expect(stats.models.find((m) => m.model === "opus")!.cacheRatio).toBeNull()
    expect(stats.totals.cacheRatio).toBeCloseTo(0.75)
  })

  test("fills every day of the series window so a quiet day reads as a gap", () => {
    const stats = summarize(
      feed({
        current: [bucket({ model: "sonnet", inputTokens: 500 })],
        daily: [{ day: "2026-08-10", model: "sonnet", tokens: 500, requests: 5 }],
      }),
      NOW,
    )!
    expect(stats.series).toHaveLength(SERIES_DAYS + 1)
    expect(stats.series.at(-1)!.day).toBe("2026-08-11")
    expect(stats.series.find((p) => p.day === "2026-08-10")!.tokens).toBe(500)
    expect(stats.series.filter((p) => p.tokens === 0)).toHaveLength(SERIES_DAYS)
  })

  test("stacks the tail of the models into a single other band", () => {
    const models = Array.from({ length: 10 }, (_, i) => `model-${i}`)
    const stats = summarize(
      feed({
        current: models.map((model, i) => bucket({ model, inputTokens: (10 - i) * 100 })),
        daily: models.map((model) => ({ day: "2026-08-10", model, tokens: 10, requests: 1 })),
      }),
      NOW,
    )!
    expect(stats.seriesModels.at(-1)).toBe("other")
    const banded = stats.seriesModels.length - 1
    expect(stats.seriesModels.slice(0, banded)).toEqual(stats.models.slice(0, banded).map((m) => m.model))
    expect(stats.series.find((p) => p.day === "2026-08-10")!.byModel.other).toBe((models.length - banded) * 10)
  })
})

describe("activity grid", () => {
  const activityFeed = (rows: { date: string; tokens: number }[]) =>
    feed({
      current: [bucket({ model: "sonnet", inputTokens: 1_000 })],
      activity: rows.map((row) => ({ ...row, requests: 1, costUsd: 0 })),
    })

  test("covers a full year of days even though the feed only sends busy ones", () => {
    const stats = summarize(activityFeed([{ date: "2026-08-10", tokens: 400 }]), NOW)!
    expect(stats.activity).toHaveLength(ACTIVITY_DAYS)
    expect(stats.activity.at(-1)!.date).toBe("2026-08-11")
    expect(stats.activity.find((d) => d.date === "2026-08-10")!.tokens).toBe(400)
  })

  test("keeps a busy day on its real weekday when quiet days sit before it", () => {
    // 2026-08-10 is a Monday, so it belongs in row 0 of the grid.
    const stats = summarize(activityFeed([{ date: "2026-08-10", tokens: 400 }]), NOW)!
    const { cells, startDate } = stats.activityGrid
    const firstDow = (new Date(`${startDate}T00:00:00Z`).getUTCDay() + 6) % 7
    const offset = (Date.UTC(2026, 7, 10) - Date.parse(`${startDate}T00:00:00Z`)) / (DAY * 1000) + firstDow
    expect(cells[offset % 7][Math.floor(offset / 7)]).toBe(400)
    expect(offset % 7).toBe(0)
  })

  test("summarises streaks and totals over the dense year", () => {
    const stats = summarize(
      activityFeed([
        { date: "2026-08-09", tokens: 100 },
        { date: "2026-08-10", tokens: 400 },
        { date: "2026-08-11", tokens: 200 },
      ]),
      NOW,
    )!
    expect(stats.activityStats.activeDays).toBe(3)
    expect(stats.activityStats.longestStreak).toBe(3)
    expect(stats.activityStats.maxDay).toBe(400)
    expect(stats.activityStats.total).toBe(700)
  })
})

describe("summarizeCommunity", () => {
  const report = (over: Record<string, unknown> = {}) => ({
    generatedAt: NOW,
    windowDays: 30,
    seriesDays: SERIES_DAYS,
    installsInWindow: 0,
    current: [],
    previous: [],
    daily: [],
    installs: [],
    ...over,
  })
  const row = (over: Record<string, unknown> & { model: string }) => ({
    provider: "anthropic",
    messages: 0,
    tokens: 0,
    cost: 0,
    installs: 1,
    ...over,
  })

  test("reports nothing rather than an empty page when no install has reported", () => {
    expect(summarizeCommunity(report(), NOW)).toBeNull()
    expect(summarizeCommunity(null, NOW)).toBeNull()
  })

  test("ranks by tokens and shares add up to the whole window", () => {
    const stats = summarizeCommunity(
      report({
        current: [row({ model: "gpt-5.1", tokens: 250 }), row({ model: "sonnet-4-5", tokens: 750 })],
        installsInWindow: 42,
      }),
      NOW,
    )!
    expect(stats.models.map((m) => m.model)).toEqual(["sonnet-4-5", "gpt-5.1"])
    expect(stats.models[0].share).toBeCloseTo(0.75)
    expect(stats.totals.installs).toBe(42)
  })

  test("takes installs per model from the feed's own distinct count", () => {
    const stats = summarizeCommunity(
      report({
        current: [
          row({ model: "sonnet-4-5", provider: "anthropic", tokens: 800, installs: 30 }),
          row({ model: "sonnet-4-5", provider: "bedrock", tokens: 200, installs: 5 }),
        ],
        // Neither 35 (double-counts an install that used both providers) nor 30
        // (undercounts installs that used only bedrock) is right. Only a count
        // over the raw identifiers is, and the feed is where they still exist.
        modelInstalls: [{ model: "sonnet-4-5", installs: 32 }],
      }),
      NOW,
    )!
    expect(stats.models).toHaveLength(1)
    expect(stats.models[0].tokens).toBe(1000)
    expect(stats.models[0].provider).toBe("anthropic")
    expect(stats.models[0].installs).toBe(32)
  })

  test("reports no install count rather than a wrong one on an older feed", () => {
    const stats = summarizeCommunity(
      report({
        current: [
          row({ model: "sonnet-4-5", provider: "anthropic", tokens: 800, installs: 30 }),
          row({ model: "sonnet-4-5", provider: "bedrock", tokens: 200, installs: 5 }),
        ],
      }),
      NOW,
    )!
    expect(stats.models[0].tokens).toBe(1000)
    expect(stats.models[0].installs).toBe(0)
  })

  test("compares against the window before and marks first-seen models new", () => {
    const stats = summarizeCommunity(
      report({
        current: [row({ model: "sonnet-4-5", tokens: 300 }), row({ model: "glm-4.6", tokens: 100 })],
        previous: [row({ model: "sonnet-4-5", tokens: 150 })],
      }),
      NOW,
    )!
    expect(stats.models.find((m) => m.model === "sonnet-4-5")!.change).toBeCloseTo(1)
    expect(stats.models.find((m) => m.model === "glm-4.6")!.change).toBeNull()
  })

  test("fills the daily series so quiet days stay visible", () => {
    const stats = summarizeCommunity(
      report({
        current: [row({ model: "sonnet-4-5", tokens: 500 })],
        daily: [{ day: "2026-08-10", model: "sonnet-4-5", tokens: 500, messages: 12 }],
        installs: [{ day: "2026-08-10", installs: 7 }],
      }),
      NOW,
    )!
    expect(stats.series).toHaveLength(SERIES_DAYS + 1)
    expect(stats.series.find((p) => p.day === "2026-08-10")!.tokens).toBe(500)
    expect(stats.installs).toEqual([{ day: "2026-08-10", installs: 7 }])
  })
})

describe("fetchCommunity", () => {
  test("returns null with no feed URL", async () => {
    expect(await fetchCommunity(undefined, NOW)).toBeNull()
  })

  test("returns null when the feed is unreachable, instead of failing the render", async () => {
    const fetcher = (async () => {
      throw new Error("network down")
    }) as unknown as typeof fetch
    expect(await fetchCommunity("https://example.test/community.json", NOW, fetcher)).toBeNull()
  })
})

describe("fetchGateway", () => {
  test("returns null with no feed URL instead of throwing on a public page", async () => {
    expect(await fetchGateway(undefined, NOW)).toBeNull()
  })

  test("returns null when the feed answers with an error status", async () => {
    const fetcher = (async () => new Response("nope", { status: 503 })) as unknown as typeof fetch
    expect(await fetchGateway("https://example.test/data.json", NOW, fetcher)).toBeNull()
  })

  test("returns null when the request itself fails, instead of failing the render", async () => {
    const fetcher = (async () => {
      throw new Error("network down")
    }) as unknown as typeof fetch
    expect(await fetchGateway("https://example.test/data.json", NOW, fetcher)).toBeNull()
  })

  test("summarises a well-formed feed", async () => {
    const body = feed({ current: [bucket({ model: "sonnet", inputTokens: 1_000, costUsd: 2 })] })
    const fetcher = (async () => new Response(JSON.stringify(body))) as unknown as typeof fetch
    const stats = (await fetchGateway("https://example.test/data.json", NOW, fetcher))!
    expect(stats.totals.tokens).toBe(1_000)
    expect(stats.totals.costUsd).toBe(2)
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
