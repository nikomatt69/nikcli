import { describe, expect, it } from "bun:test"

// Reference: the OLD array-based aggregation
type OldModelRow = { modelKey: string; tokens: number; cost: number; messages: number }
function oldAggregate(
  messages: Array<{ modelKey: string; tokens: number; cost: number; messages: number }>,
): OldModelRow[] {
  const models: OldModelRow[] = []
  for (const m of messages) {
    const existing = models.find((x) => x.modelKey === m.modelKey)
    if (existing) {
      existing.tokens += m.tokens
      existing.cost += m.cost
      existing.messages += m.messages
    } else {
      models.push({ ...m })
    }
  }
  return models
}

// New map-based aggregation
function newAggregate(
  messages: Array<{ modelKey: string; tokens: number; cost: number; messages: number }>,
): Map<string, OldModelRow> {
  const models = new Map<string, OldModelRow>()
  for (const m of messages) {
    const existing = models.get(m.modelKey)
    if (existing) {
      existing.tokens += m.tokens
      existing.cost += m.cost
      existing.messages += m.messages
    } else {
      models.set(m.modelKey, { ...m })
    }
  }
  return models
}

function deepEqual(a: OldModelRow, b: OldModelRow) {
  return a.modelKey === b.modelKey && a.tokens === b.tokens && a.cost === b.cost && a.messages === b.messages
}

describe("analytics-aggregator Array.find → Map.get", () => {
  it("produces equivalent totals for many messages per modelKey", () => {
    const messages: OldModelRow[] = []
    const keys = ["openai/gpt-4", "anthropic/claude-3", "google/gemini-pro"]
    for (let i = 0; i < 100; i++) {
      messages.push({ modelKey: keys[i % keys.length], tokens: 10, cost: 0.001, messages: 1 })
    }
    const oldRes = oldAggregate(messages)
    const newRes = newAggregate(messages)

    // Map totals should match Array totals
    for (const oldRow of oldRes) {
      const newRow = newRes.get(oldRow.modelKey)
      expect(newRow).toBeDefined()
      expect(deepEqual(oldRow, newRow!)).toBe(true)
    }
  })

  it("produces equivalent totals for many modelKeys per message", () => {
    const messages: OldModelRow[] = []
    for (let i = 0; i < 500; i++) {
      messages.push({ modelKey: `model-${i}`, tokens: 5, cost: 0.01, messages: 1 })
    }
    const oldRes = oldAggregate(messages)
    const newRes = newAggregate(messages)

    expect(newRes.size).toBe(oldRes.length)
    for (const oldRow of oldRes) {
      const newRow = newRes.get(oldRow.modelKey)
      expect(newRow).toBeDefined()
      expect(deepEqual(oldRow, newRow!)).toBe(true)
    }
  })

  it("perf sanity: O(M+K) vs O(M*K) — large input is fast", () => {
    // 5000 messages × 50 distinct modelKeys
    const messages: OldModelRow[] = []
    for (let i = 0; i < 5000; i++) {
      messages.push({ modelKey: `m-${i % 50}`, tokens: 1, cost: 0, messages: 1 })
    }
    const startOld = performance.now()
    oldAggregate(messages)
    const oldMs = performance.now() - startOld
    const startNew = performance.now()
    newAggregate(messages)
    const newMs = performance.now() - startNew
    // New version should be faster (or at least not slower). Print for visibility.
    // On a typical dev box newMs should be < oldMs / 5.
    console.log(`old=${oldMs.toFixed(2)}ms new=${newMs.toFixed(2)}ms speedup=${(oldMs / newMs).toFixed(1)}x`)
    expect(newMs).toBeLessThanOrEqual(oldMs)
  })
})
