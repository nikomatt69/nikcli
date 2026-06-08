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

  it("parses compound units and whitespace", () => {
    expect(Store.parseDuration("1h30m")).toBe(5_400_000)
    expect(Store.parseDuration(" 1h 30m ")).toBe(5_400_000)
  })

  it("treats a bare integer as minutes", () => {
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

describe("loops/store · validateDraft", () => {
  it("requires an objective", () => {
    expect(Store.validateDraft({ objective: "" })).toBeDefined()
    expect(Store.validateDraft({ objective: "   " })).toBeDefined()
    expect(Store.validateDraft({ objective: "do the thing" })).toBeUndefined()
  })

  it("enforces the minimum interval", () => {
    expect(Store.validateDraft({ objective: "x", intervalMs: 1_000 })).toBeDefined()
    expect(Store.validateDraft({ objective: "x", intervalMs: Store.MIN_INTERVAL_MS })).toBeUndefined()
  })

  it("rejects non-positive budgets and run caps", () => {
    expect(Store.validateDraft({ objective: "x", tokenBudget: 0 })).toBeDefined()
    expect(Store.validateDraft({ objective: "x", tokenBudget: 1.5 })).toBeDefined()
    expect(Store.validateDraft({ objective: "x", maxRuns: -1 })).toBeDefined()
    expect(Store.validateDraft({ objective: "x", tokenBudget: 100, maxRuns: 3 })).toBeUndefined()
  })

  it("rejects objectives that collide with the goal command grammar", () => {
    // exact subcommand words would be misparsed by /goal
    expect(Store.validateDraft({ objective: "pause" })).toBeDefined()
    expect(Store.validateDraft({ objective: "STATUS" })).toBeDefined()
    // multi-word objectives that merely contain a subcommand word are fine
    expect(Store.validateDraft({ objective: "pause the failing job" })).toBeUndefined()
    // the budget flag must not appear in the objective text
    expect(Store.validateDraft({ objective: "add a --token-budget flag" })).toBeDefined()
  })
})

describe("loops/store · createDefinition", () => {
  it("derives a name and defaults to manual + ralph", () => {
    const def = Store.createDefinition({ objective: "keep CI green" })
    expect(def.name).toBe("keep CI green")
    expect(def.agent).toBe(Store.DEFAULT_AGENT)
    expect(def.trigger).toEqual({ kind: "manual" })
    expect(def.enabled).toBe(true)
    expect(def.id.startsWith("loop_")).toBe(true)
  })

  it("builds an interval trigger and carries budget", () => {
    const def = Store.createDefinition({ objective: "x", intervalMs: 600_000, tokenBudget: 1000 })
    expect(def.trigger).toEqual({ kind: "interval", everyMs: 600_000 })
    expect(def.tokenBudget).toBe(1000)
  })

  it("throws on an invalid draft", () => {
    expect(() => Store.createDefinition({ objective: "" })).toThrow()
  })

  it("truncates very long derived names", () => {
    const def = Store.createDefinition({ objective: "a".repeat(100) })
    expect(def.name.length).toBeLessThanOrEqual(48)
    expect(def.name.endsWith("…")).toBe(true)
  })
})

describe("loops/store · CRUD", () => {
  it("upserts, reads, toggles, and removes", () => {
    const kv = fakeKv()
    expect(Store.loadAll(kv)).toEqual([])

    const a = Store.createDefinition({ objective: "first" })
    const b = Store.createDefinition({ objective: "second", intervalMs: 600_000 })
    Store.upsert(kv, a)
    Store.upsert(kv, b)
    expect(Store.loadAll(kv)).toHaveLength(2)
    expect(Store.getById(kv, a.id)?.objective).toBe("first")

    // upsert replaces in place
    Store.upsert(kv, { ...a, objective: "first-edited" })
    expect(Store.loadAll(kv)).toHaveLength(2)
    expect(Store.getById(kv, a.id)?.objective).toBe("first-edited")

    const toggled = Store.setEnabled(kv, b.id, false)
    expect(toggled?.enabled).toBe(false)
    expect(Store.getById(kv, b.id)?.enabled).toBe(false)

    Store.removeById(kv, a.id)
    expect(Store.loadAll(kv)).toHaveLength(1)
    expect(Store.getById(kv, a.id)).toBeUndefined()
  })

  it("sanitizes corrupt persisted data", () => {
    const kv = fakeKv()
    kv.set(Store.LOOPS_KV_KEY, [
      { id: "ok", objective: "valid", trigger: { kind: "interval", everyMs: 600_000 } },
      { id: "bad-interval", objective: "too fast", trigger: { kind: "interval", everyMs: 5 } },
      { nonsense: true },
      null,
      "garbage",
    ])
    const loaded = Store.loadAll(kv)
    expect(loaded).toHaveLength(2)
    expect(loaded.find((d) => d.id === "ok")?.trigger).toEqual({ kind: "interval", everyMs: 600_000 })
    // sub-minimum interval is coerced back to manual rather than dropped
    expect(loaded.find((d) => d.id === "bad-interval")?.trigger).toEqual({ kind: "manual" })
  })

  it("ignores a non-array kv value", () => {
    const kv = fakeKv()
    kv.set(Store.LOOPS_KV_KEY, { not: "an array" })
    expect(Store.loadAll(kv)).toEqual([])
  })
})
