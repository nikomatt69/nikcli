import fs from "fs/promises"
import os from "os"
import path from "path"
import { afterAll, describe, expect, it } from "bun:test"

const testDir = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-remote-idem-"))
process.env.NIKCLI_TEST_HOME ??= testDir
process.env.NIKCLI_DB ??= path.join(testDir, "nikcli.db")

const { RemoteSync } = await import("@/sync/remote-sync")
const { Sync } = await import("@/sync")
const { Outbox } = await import("@/sync/outbox")

// Nothing listens here: pushes fail fast and stay in the outbox, which is
// exactly what the offline-first path expects.
const url = "http://127.0.0.1:59742"
const run = Math.random().toString(36).slice(2)

afterAll(async () => {
  await fs.rm(testDir, { recursive: true, force: true })
})

describe("RemoteSync.start", () => {
  it("is idempotent per (url, project) and enqueues local events exactly once", async () => {
    const projectID = `proj_ri_${run}`
    // Long drain interval: the test controls the outbox state directly.
    const first = await RemoteSync.start({ url, token: "t", projectID, drainIntervalMs: 3_600_000 })
    const again = await RemoteSync.start({ url, token: "t", projectID, drainIntervalMs: 3_600_000 })
    const other = await RemoteSync.start({
      url,
      token: "t",
      projectID: `proj_ri_other_${run}`,
      drainIntervalMs: 3_600_000,
    })

    try {
      expect(again).toBe(first)
      expect(other).not.toBe(first)

      const before = Outbox.status(url).total
      await Sync.emitRaw(projectID, `wrk_ri_${run}`, { type: "session.idle", properties: {} })
      expect(Outbox.status(url).total).toBe(before + 1)

      // Remote-origin events are never pushed back.
      await Sync.emitRaw(projectID, `wrk_ri_${run}`, { type: "session.idle", properties: {} }, { origin: "remote:hub" })
      expect(Outbox.status(url).total).toBe(before + 1)
    } finally {
      await first.stop()
      await other.stop()
    }

    // With every sync stopped the emit hook is removed: no new enqueues.
    const after = Outbox.status(url).total
    await Sync.emitRaw(projectID, `wrk_ri_${run}`, { type: "session.idle", properties: {} })
    expect(Outbox.status(url).total).toBe(after)

    // A fresh start works after full teardown.
    const restarted = await RemoteSync.start({ url, token: "t", projectID, drainIntervalMs: 3_600_000 })
    expect(restarted).not.toBe(first)
    await restarted.stop()
  })
})
