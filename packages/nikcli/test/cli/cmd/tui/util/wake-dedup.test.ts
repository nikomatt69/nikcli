import { describe, expect, test } from "bun:test"
import { createWakeDedup } from "@tui/util/wake-dedup"

/**
 * Extractor function that mirrors the one wired into `sdk.tsx`. Kept
 * here so the policy is testable without mounting the Solid SDK
 * provider; if the production extractor changes, this constant must
 * be updated in lockstep.
 */
const extractWakeKey = (envelope: { type?: string; properties?: unknown }): string | undefined => {
  const props = (envelope.properties ?? {}) as Record<string, unknown>
  switch (envelope.type) {
    case "delegation.completed":
      return `delegation:${props?.delegationID}:${props?.status}`
    case "loop.run.finished":
      return `loop:${props?.runID}:${props?.status}`
    case "loop.runtime.changed":
      return `loop-runtime:${props?.loopID}`
    case "mission.finished":
      return `mission:${props?.missionID}`
    case "mission.exec.finished":
      return `mission-exec:${props?.execID}:${props?.status}`
    case "session.goal":
      return `goal:${props?.sessionID}:${(props?.goal as { status?: string } | null)?.status ?? "null"}`
    default:
      return undefined
  }
}

describe("createWakeDedup", () => {
  test("first arrival passes, second is blocked", () => {
    const d = createWakeDedup((e) => (e.properties as { key?: string })?.key, {
      ttlMs: 60_000,
    })
    expect(d.shouldProcess({ type: "x", properties: { key: "k1" } })).toBe(true)
    expect(d.shouldProcess({ type: "x", properties: { key: "k1" } })).toBe(false)
  })

  test("different keys both pass", () => {
    const d = createWakeDedup((e) => (e.properties as { key?: string })?.key, {
      ttlMs: 60_000,
    })
    expect(d.shouldProcess({ type: "x", properties: { key: "k1" } })).toBe(true)
    expect(d.shouldProcess({ type: "x", properties: { key: "k2" } })).toBe(true)
    expect(d.shouldProcess({ type: "x", properties: { key: "k3" } })).toBe(true)
  })

  test("missing key returns true (non-blocking)", () => {
    const d = createWakeDedup(() => undefined, { ttlMs: 60_000 })
    expect(d.shouldProcess({ type: "x" })).toBe(true)
    expect(d.shouldProcess({ type: "x" })).toBe(true)
  })

  test("TTL expiry allows re-processing", () => {
    let now = 1_000
    const d = createWakeDedup((e) => (e.properties as { key?: string })?.key, {
      ttlMs: 100,
      now: () => now,
    })
    expect(d.shouldProcess({ type: "x", properties: { key: "k1" } })).toBe(true)
    expect(d.shouldProcess({ type: "x", properties: { key: "k1" } })).toBe(false)
    // Advance past TTL
    now += 101
    expect(d.shouldProcess({ type: "x", properties: { key: "k1" } })).toBe(true)
  })

  test("LRU overflow evicts oldest", () => {
    const d = createWakeDedup((e) => (e.properties as { key?: string })?.key, {
      maxEntries: 3,
      ttlMs: 60_000,
    })
    // Fill capacity (LRU order: k1, k2, k3)
    d.shouldProcess({ type: "x", properties: { key: "k1" } })
    d.shouldProcess({ type: "x", properties: { key: "k2" } })
    d.shouldProcess({ type: "x", properties: { key: "k3" } })
    // Overflow: k4 forces eviction of k1 (oldest). Order: k2, k3, k4
    d.shouldProcess({ type: "x", properties: { key: "k4" } })
    // k1 was evicted: should pass again
    expect(d.shouldProcess({ type: "x", properties: { key: "k1" } })).toBe(true)
    // k2 was evicted by the previous insert (LRU order is now k3, k4, k1).
    // The dedup is LRU + cap, not MRU-on-touch, so re-asking k2 is a miss.
    expect(d.shouldProcess({ type: "x", properties: { key: "k2" } })).toBe(true)
  })

  test("forget removes a key", () => {
    const d = createWakeDedup((e) => (e.properties as { key?: string })?.key, {
      ttlMs: 60_000,
    })
    d.shouldProcess({ type: "x", properties: { key: "k1" } })
    expect(d.shouldProcess({ type: "x", properties: { key: "k1" } })).toBe(false)
    d.forget("k1")
    expect(d.shouldProcess({ type: "x", properties: { key: "k1" } })).toBe(true)
  })

  test("size reports the number of tracked keys", () => {
    const d = createWakeDedup((e) => (e.properties as { key?: string })?.key, {
      ttlMs: 60_000,
    })
    expect(d.size()).toBe(0)
    d.shouldProcess({ type: "x", properties: { key: "k1" } })
    d.shouldProcess({ type: "x", properties: { key: "k2" } })
    expect(d.size()).toBe(2)
  })

  test("default options: 256 entries, 60s TTL", () => {
    const d = createWakeDedup((e) => (e.properties as { key?: string })?.key)
    d.shouldProcess({ type: "x", properties: { key: "k1" } })
    // Default maxEntries is 256, so 256 entries should fit
    for (let i = 0; i < 255; i++) {
      d.shouldProcess({ type: "x", properties: { key: `k${i + 2}` } })
    }
    expect(d.size()).toBe(256)
  })

  test("clear resets all tracked keys", () => {
    const d = createWakeDedup((e) => (e.properties as { key?: string })?.key, {
      ttlMs: 60_000,
    })
    d.shouldProcess({ type: "x", properties: { key: "k1" } })
    d.shouldProcess({ type: "x", properties: { key: "k2" } })
    expect(d.size()).toBe(2)
    d.clear()
    expect(d.size()).toBe(0)
    expect(d.shouldProcess({ type: "x", properties: { key: "k1" } })).toBe(true)
  })
})

describe("wake-dedup production extractor (delegation.completed)", () => {
  test("coalesces duplicate delegation.completed for the same delegationID", () => {
    const d = createWakeDedup(extractWakeKey, { ttlMs: 60_000 })
    const env = {
      type: "delegation.completed",
      properties: { delegationID: "d1", status: "complete" },
    }
    expect(d.shouldProcess(env)).toBe(true)
    expect(d.shouldProcess(env)).toBe(false)
  })

  test("differentiates by status (re-completion after error is fresh)", () => {
    const d = createWakeDedup(extractWakeKey, { ttlMs: 60_000 })
    expect(
      d.shouldProcess({
        type: "delegation.completed",
        properties: { delegationID: "d1", status: "error" },
      }),
    ).toBe(true)
    expect(
      d.shouldProcess({
        type: "delegation.completed",
        properties: { delegationID: "d1", status: "complete" },
      }),
    ).toBe(true)
  })

  test("different delegationIDs are independent", () => {
    const d = createWakeDedup(extractWakeKey, { ttlMs: 60_000 })
    const env1 = {
      type: "delegation.completed",
      properties: { delegationID: "d1" },
    }
    const env2 = {
      type: "delegation.completed",
      properties: { delegationID: "d2" },
    }
    expect(d.shouldProcess(env1)).toBe(true)
    expect(d.shouldProcess(env2)).toBe(true)
    expect(d.shouldProcess(env1)).toBe(false)
    expect(d.shouldProcess(env2)).toBe(false)
  })
})

describe("wake-dedup production extractor (loop, mission, goal)", () => {
  test("loop.run.finished keyed by runID+status", () => {
    const d = createWakeDedup(extractWakeKey, { ttlMs: 60_000 })
    const env = {
      type: "loop.run.finished",
      properties: { runID: "r1", status: "complete" },
    }
    expect(d.shouldProcess(env)).toBe(true)
    expect(d.shouldProcess(env)).toBe(false)
  })

  test("loop.runtime.changed keyed by loopID only", () => {
    const d = createWakeDedup(extractWakeKey, { ttlMs: 60_000 })
    const env = { type: "loop.runtime.changed", properties: { loopID: "l1" } }
    expect(d.shouldProcess(env)).toBe(true)
    expect(d.shouldProcess(env)).toBe(false)
  })

  test("mission.finished keyed by missionID", () => {
    const d = createWakeDedup(extractWakeKey, { ttlMs: 60_000 })
    const env = { type: "mission.finished", properties: { missionID: "m1" } }
    expect(d.shouldProcess(env)).toBe(true)
    expect(d.shouldProcess(env)).toBe(false)
  })

  test("mission.exec.finished keyed by execID+status", () => {
    const d = createWakeDedup(extractWakeKey, { ttlMs: 60_000 })
    const env = {
      type: "mission.exec.finished",
      properties: { execID: "e1", status: "complete" },
    }
    expect(d.shouldProcess(env)).toBe(true)
    expect(d.shouldProcess(env)).toBe(false)
  })

  test("session.goal keyed by sessionID+goal.status", () => {
    const d = createWakeDedup(extractWakeKey, { ttlMs: 60_000 })
    const env = {
      type: "session.goal",
      properties: { sessionID: "s1", goal: { status: "complete" } },
    }
    expect(d.shouldProcess(env)).toBe(true)
    expect(d.shouldProcess(env)).toBe(false)
  })

  test("session.goal with null goal falls back to 'null' literal", () => {
    const d = createWakeDedup(extractWakeKey, { ttlMs: 60_000 })
    const env = {
      type: "session.goal",
      properties: { sessionID: "s1", goal: null },
    }
    expect(d.shouldProcess(env)).toBe(true)
    expect(d.shouldProcess(env)).toBe(false)
  })

  test("unmapped event types are non-blocking (default-allow)", () => {
    const d = createWakeDedup(extractWakeKey, { ttlMs: 60_000 })
    expect(d.shouldProcess({ type: "message.updated", properties: { id: "m1" } })).toBe(true)
    expect(d.shouldProcess({ type: "message.updated", properties: { id: "m1" } })).toBe(true)
    expect(d.shouldProcess({ type: "session.created", properties: { id: "s1" } })).toBe(true)
  })
})
