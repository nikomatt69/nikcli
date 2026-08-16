import { describe, expect, it } from "bun:test"
import * as Store from "@tui/feature-plugins/loops/store"

function fakeKv(): Store.KvLike {
  const data: Record<string, unknown> = {}
  return {
    get<T>(key: string, fallback?: T): T {
      return (key in data ? data[key] : fallback) as T
    },
    set(key: string, value: unknown) {
      data[key] = value
    },
  }
}

function makeDraft(overrides: Partial<Store.LoopDraft> = {}): Store.LoopDraft {
  return {
    name: "draft",
    stages: [{ name: "stage", agent: "ralph", objective: "do it" }],
    ...overrides,
  }
}

function makeRun(overrides: Partial<Store.LoopRun> = {}): Store.LoopRun {
  return {
    startedAt: 1,
    endedAt: 2,
    ok: true,
    additions: 0,
    deletions: 0,
    files: 0,
    ...overrides,
  }
}

describe("loops/store · loadAll / saveAll / round-trip", () => {
  it("saveAll persists every definition under its id", () => {
    const kv = fakeKv()
    const a = Store.createDefinition(makeDraft({ name: "a" }))
    const b = Store.createDefinition(makeDraft({ name: "b" }))
    Store.saveAll(kv, [a, b])
    expect(Store.loadAll(kv)).toHaveLength(2)
    expect(Store.getById(kv, a.id)?.id).toBe(a.id)
    expect(Store.getById(kv, b.id)?.id).toBe(b.id)
  })

  it("loadAll drops corrupt records without throwing", () => {
    const kv = fakeKv()
    const a = Store.createDefinition(makeDraft({ name: "a" }))
    Store.upsert(kv, a)
    // Corrupt one record directly.
    kv.set(`loops:bogus`, { not: "a loop" })
    const defs = Store.loadAll(kv)
    // The valid record survives; bogus is silently dropped.
    expect(defs.find((d) => d.id === a.id)).toBeDefined()
  })
})

describe("loops/store · setEnabled (KV side)", () => {
  it("toggles the enabled flag locally", () => {
    const kv = fakeKv()
    const def = Store.createDefinition(makeDraft({ name: "a" }))
    Store.upsert(kv, def)
    Store.setEnabled(kv, def.id, false)
    expect(Store.getById(kv, def.id)?.enabled).toBe(false)
  })

  it("no-op for unknown ids", () => {
    const kv = fakeKv()
    Store.setEnabled(kv, "missing", false)
    expect(Store.getById(kv, "missing")).toBeUndefined()
  })
})

describe("loops/store · removeById", () => {
  it("deletes the definition under the given id", () => {
    const kv = fakeKv()
    const def = Store.createDefinition(makeDraft({ name: "a" }))
    Store.upsert(kv, def)
    Store.removeById(kv, def.id)
    expect(Store.getById(kv, def.id)).toBeUndefined()
  })

  it("no-op for unknown ids", () => {
    const kv = fakeKv()
    Store.removeById(kv, "missing")
    expect(Store.loadAll(kv)).toHaveLength(0)
  })
})

describe("loops/store · recordRun + loadHistory", () => {
  it("appends and truncates history to the configured limit", () => {
    const kv = fakeKv()
    for (let i = 0; i < 80; i++) {
      Store.recordRun(kv, "loop_x", makeRun({ startedAt: i, endedAt: i + 1, ok: i % 2 === 0 }))
    }
    const history = Store.loadHistory(kv, "loop_x")
    expect(history.length).toBeLessThanOrEqual(Store.HISTORY_LIMIT)
  })

  it("clearHistory removes every entry for a loop", () => {
    const kv = fakeKv()
    Store.recordRun(kv, "loop_x", makeRun())
    Store.clearHistory(kv, "loop_x")
    expect(Store.loadHistory(kv, "loop_x")).toHaveLength(0)
  })
})

describe("loops/store · loopStats", () => {
  it("computes success rate, total, and totals", () => {
    const stats = Store.loopStats([
      makeRun({
        startedAt: 1,
        endedAt: 2,
        ok: true,
        additions: 10,
        deletions: 5,
      }),
      makeRun({
        startedAt: 3,
        endedAt: 4,
        ok: false,
        additions: 0,
        deletions: 0,
      }),
      makeRun({
        startedAt: 5,
        endedAt: 6,
        ok: true,
        additions: 20,
        deletions: 10,
      }),
    ])
    expect(stats.total).toBe(3)
    expect(stats.ok).toBe(2)
    expect(stats.successRate).toBeCloseTo(2 / 3)
    expect(stats.additions).toBe(30)
    expect(stats.deletions).toBe(15)
  })

  it("returns zeros for an empty history", () => {
    expect(Store.loopStats([])).toEqual({
      total: 0,
      ok: 0,
      successRate: 0,
      additions: 0,
      deletions: 0,
    })
  })
})
