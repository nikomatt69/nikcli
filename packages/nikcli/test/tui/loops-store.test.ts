import { describe, expect, it } from "bun:test"
import * as Store from "@/cli/cmd/tui/feature-plugins/loops/store"

function fakeKv(): Store.KvLike & { data: Record<string, unknown> } {
  const data: Record<string, unknown> = {}
  return {
    data,
    get<T>(key: string, fallback?: T): T {
      return (key in data ? data[key] : fallback) as T
    },
    set(key: string, value: unknown) {
      data[key] = value
    },
  }
}

describe("loops/store · parseDuration", () => {
  it("parses single units", () => {
    expect(Store.parseDuration("30s")).toBe(30_000)
    expect(Store.parseDuration("10m")).toBe(600_000)
    expect(Store.parseDuration("2h")).toBe(7_200_000)
    expect(Store.parseDuration("1d")).toBe(86_400_000)
  })

  it("parses compound units and whitespace, bare int as minutes", () => {
    expect(Store.parseDuration("1h30m")).toBe(5_400_000)
    expect(Store.parseDuration(" 1h 30m ")).toBe(5_400_000)
    expect(Store.parseDuration("5")).toBe(300_000)
  })

  it("rejects garbage", () => {
    expect(() => Store.parseDuration("10mfoo")).toThrow()
    expect(() => Store.parseDuration("abc")).toThrow()
    expect(() => Store.parseDuration("")).toThrow()
  })
})

describe("loops/store · formatDuration", () => {
  it("round-trips representative values", () => {
    expect(Store.formatDuration(30_000)).toBe("30s")
    expect(Store.formatDuration(600_000)).toBe("10m")
    expect(Store.formatDuration(5_400_000)).toBe("1h 30m")
    expect(Store.formatDuration(7_200_000)).toBe("2h")
  })
})

describe("loops/store · validateStage", () => {
  it("requires an objective", () => {
    expect(Store.validateStage({ objective: "" })).toBeDefined()
    expect(Store.validateStage({ objective: "   " })).toBeDefined()
    expect(Store.validateStage({ objective: "do the thing" })).toBeUndefined()
  })

  it("rejects objectives that collide with the goal command grammar", () => {
    expect(Store.validateStage({ objective: "pause" })).toBeDefined()
    expect(Store.validateStage({ objective: "STATUS" })).toBeDefined()
    expect(Store.validateStage({ objective: "pause the failing job" })).toBeUndefined()
    expect(Store.validateStage({ objective: "add a --token-budget flag" })).toBeDefined()
  })

  it("validates agent, model shape and budget", () => {
    expect(Store.validateStage({ objective: "x", agent: "   " })).toBeDefined()
    expect(Store.validateStage({ objective: "x", model: "no-slash" })).toBeDefined()
    expect(Store.validateStage({ objective: "x", model: "/leading" })).toBeDefined()
    expect(Store.validateStage({ objective: "x", model: "trailing/" })).toBeDefined()
    expect(Store.validateStage({ objective: "x", model: "anthropic/claude-opus-4-8" })).toBeUndefined()
    expect(Store.validateStage({ objective: "x", tokenBudget: 0 })).toBeDefined()
    expect(Store.validateStage({ objective: "x", tokenBudget: 1.5 })).toBeDefined()
    expect(Store.validateStage({ objective: "x", tokenBudget: 100 })).toBeUndefined()
  })
})

describe("loops/store · validateDraft", () => {
  it("requires at least one stage", () => {
    expect(Store.validateDraft({ stages: [] })).toBeDefined()
    expect(Store.validateDraft({ stages: [{ objective: "go" }] })).toBeUndefined()
  })

  it("surfaces a bad stage and enforces interval/maxRuns", () => {
    expect(Store.validateDraft({ stages: [{ objective: "" }] })).toBeDefined()
    expect(Store.validateDraft({ stages: [{ objective: "x" }], intervalMs: 1_000 })).toBeDefined()
    expect(Store.validateDraft({ stages: [{ objective: "x" }], intervalMs: Store.MIN_INTERVAL_MS })).toBeUndefined()
    expect(Store.validateDraft({ stages: [{ objective: "x" }], maxRuns: -1 })).toBeDefined()
  })
})

describe("loops/store · createDefinition", () => {
  it("builds a single-stage pipeline with defaults", () => {
    const def = Store.createDefinition({ stages: [{ objective: "keep CI green" }] })
    expect(def.stages).toHaveLength(1)
    expect(def.name).toBe("keep CI green")
    expect(def.stages[0].agent).toBe(Store.DEFAULT_AGENT)
    expect(def.trigger).toEqual({ kind: "manual" })
    expect(def.enabled).toBe(true)
    expect(def.id.startsWith("loop_")).toBe(true)
  })

  it("builds a multi-stage pipeline with per-stage agent/model and an interval", () => {
    const def = Store.createDefinition({
      name: "ship feature",
      intervalMs: 600_000,
      stages: [
        { name: "explore", objective: "map the code", agent: "general", model: "anthropic/claude-sonnet-4-5" },
        { name: "implement", objective: "write it", agent: "ralph", tokenBudget: 200_000 },
      ],
    })
    expect(def.name).toBe("ship feature")
    expect(def.trigger).toEqual({ kind: "interval", everyMs: 600_000 })
    expect(def.stages.map((s) => s.agent)).toEqual(["general", "ralph"])
    expect(def.stages[0].model).toBe("anthropic/claude-sonnet-4-5")
    expect(def.stages[1].tokenBudget).toBe(200_000)
  })

  it("throws on an invalid draft", () => {
    expect(() => Store.createDefinition({ stages: [] })).toThrow()
  })
})

describe("loops/store · sanitize & migration", () => {
  it("migrates a legacy single-objective loop into one stage", () => {
    const kv = fakeKv()
    kv.set(Store.LOOPS_KV_KEY, [
      { id: "old", objective: "legacy goal", agent: "build", model: "anthropic/x", tokenBudget: 100 },
    ])
    const loaded = Store.loadAll(kv)
    expect(loaded).toHaveLength(1)
    expect(loaded[0].stages).toHaveLength(1)
    expect(loaded[0].stages[0].objective).toBe("legacy goal")
    expect(loaded[0].stages[0].agent).toBe("build")
    expect(loaded[0].name).toBe("legacy goal")
  })

  it("keeps a valid staged loop and drops corrupt entries", () => {
    const kv = fakeKv()
    kv.set(Store.LOOPS_KV_KEY, [
      { id: "a", stages: [{ objective: "s1", agent: "ralph" }], trigger: { kind: "interval", everyMs: 600_000 } },
      { id: "no-stages", stages: [] },
      { id: "no-objective" },
      null,
      "garbage",
    ])
    const loaded = Store.loadAll(kv)
    expect(loaded.map((d) => d.id)).toEqual(["a"])
    expect(loaded[0].stages[0].objective).toBe("s1")
  })

  it("coerces a sub-minimum interval back to manual", () => {
    const kv = fakeKv()
    kv.set(Store.LOOPS_KV_KEY, [{ id: "a", stages: [{ objective: "x" }], trigger: { kind: "interval", everyMs: 5 } }])
    expect(Store.loadAll(kv)[0].trigger).toEqual({ kind: "manual" })
  })

  it("ignores a non-array kv value", () => {
    const kv = fakeKv()
    kv.set(Store.LOOPS_KV_KEY, { not: "an array" })
    expect(Store.loadAll(kv)).toEqual([])
  })
})

describe("loops/store · CRUD", () => {
  it("upserts, reads, toggles, and removes", () => {
    const kv = fakeKv()
    const a = Store.createDefinition({ stages: [{ objective: "first" }] })
    const b = Store.createDefinition({ stages: [{ objective: "second" }], intervalMs: 600_000 })
    Store.upsert(kv, a)
    Store.upsert(kv, b)
    expect(Store.loadAll(kv)).toHaveLength(2)

    Store.upsert(kv, { ...a, name: "renamed" })
    expect(Store.loadAll(kv)).toHaveLength(2)
    expect(Store.getById(kv, a.id)?.name).toBe("renamed")

    expect(Store.setEnabled(kv, b.id, false)?.enabled).toBe(false)
    Store.removeById(kv, a.id)
    expect(Store.loadAll(kv)).toHaveLength(1)
    expect(Store.getById(kv, a.id)).toBeUndefined()
  })
})

describe("loops/store · run history", () => {
  const run = (over: Partial<Store.LoopRun> = {}): Store.LoopRun => ({
    startedAt: 1_000,
    endedAt: 2_000,
    ok: true,
    additions: 0,
    deletions: 0,
    files: 0,
    ...over,
  })

  it("records runs most-recent-first and isolates loops", () => {
    const kv = fakeKv()
    Store.recordRun(kv, "a", run({ endedAt: 100 }))
    Store.recordRun(kv, "a", run({ endedAt: 300 }))
    Store.recordRun(kv, "b", run({ endedAt: 200 }))
    expect(Store.loadHistory(kv, "a").map((r) => r.endedAt)).toEqual([300, 100])
    expect(Store.loadHistory(kv, "b")).toHaveLength(1)
  })

  it("caps history at HISTORY_LIMIT, dropping the oldest", () => {
    const kv = fakeKv()
    for (let i = 0; i < Store.HISTORY_LIMIT + 5; i++) Store.recordRun(kv, "a", run({ startedAt: i, endedAt: i }))
    const a = Store.loadHistory(kv, "a")
    expect(a).toHaveLength(Store.HISTORY_LIMIT)
    expect(a[0].endedAt).toBe(Store.HISTORY_LIMIT + 4)
    expect(Math.min(...a.map((r) => r.endedAt))).toBe(5)
  })

  it("preserves per-stage results and the session id in a run", () => {
    const kv = fakeKv()
    Store.recordRun(
      kv,
      "a",
      run({ sessionID: "ses_123", stages: [{ name: "explore", ok: true, additions: 3, deletions: 0, files: 1 }] }),
    )
    const recorded = Store.loadHistory(kv, "a")[0]
    expect(recorded.stages?.[0].name).toBe("explore")
    expect(recorded.sessionID).toBe("ses_123")
  })

  it("computes aggregate stats and clears per loop", () => {
    const kv = fakeKv()
    Store.recordRun(kv, "a", run({ ok: true, additions: 10, deletions: 2 }))
    Store.recordRun(kv, "a", run({ ok: false, additions: 5, deletions: 1 }))
    Store.recordRun(kv, "a", run({ ok: true }))
    const stats = Store.loopStats(Store.loadHistory(kv, "a"))
    expect(stats).toEqual({ total: 3, ok: 2, successRate: 2 / 3, additions: 15, deletions: 3 })
    Store.clearHistory(kv, "a")
    expect(Store.loadHistory(kv, "a")).toEqual([])
  })

  it("loopStats on no runs is zeroed", () => {
    expect(Store.loopStats([])).toEqual({ total: 0, ok: 0, successRate: 0, additions: 0, deletions: 0 })
  })
})

describe("loops/store · diffDelta", () => {
  it("attributes only the increase since the baseline (no double-counting)", () => {
    const before = { "a.ts": { additions: 10, deletions: 2 } }
    const after = { "a.ts": { additions: 14, deletions: 2 }, "b.ts": { additions: 3, deletions: 0 } }
    expect(Store.diffDelta(before, after)).toEqual({ additions: 7, deletions: 0, files: 2 })
  })

  it("ignores unchanged files and never goes negative", () => {
    const snap = { "a.ts": { additions: 10, deletions: 5 } }
    expect(Store.diffDelta(snap, snap)).toEqual({ additions: 0, deletions: 0, files: 0 })
    expect(
      Store.diffDelta({ "a.ts": { additions: 10, deletions: 0 } }, { "a.ts": { additions: 4, deletions: 0 } }),
    ).toEqual({ additions: 0, deletions: 0, files: 0 })
  })

  it("counts a fresh run from an empty baseline", () => {
    expect(Store.diffDelta({}, { "x.ts": { additions: 2, deletions: 9 } })).toEqual({
      additions: 2,
      deletions: 9,
      files: 1,
    })
  })
})
