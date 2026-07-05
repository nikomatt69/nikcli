import fs from "fs/promises"
import os from "os"
import path from "path"
import { afterAll, describe, expect, it } from "bun:test"

const testDir = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-remote-sync-"))
process.env.NIKCLI_TEST_HOME ??= testDir
process.env.NIKCLI_DB ??= path.join(testDir, "nikcli.db")
process.env.XDG_DATA_HOME ??= path.join(testDir, "data")

const { RemoteSync } = await import("@/sync/remote-sync")
const { createInMemoryRemoteTransport, createInMemoryScheduler } = await import("@/sync/transport")
const { Sync } = await import("@/sync")
import type { SyncEventRecord } from "@/sync"

const run = Math.random().toString(36).slice(2)

afterAll(async () => {
  if (process.env.NIKCLI_DB === path.join(testDir, "nikcli.db")) {
    await fs.rm(testDir, { recursive: true, force: true })
  }
})

const sample = (seq: number, type = "remote.injected"): SyncEventRecord => ({
  id: `evt_remote_${seq}_${run}`,
  projectId: `proj_remote_${run}`,
  aggregate: `wrk_remote_${run}`,
  seq,
  type,
  data: { seq },
  timestamp: Date.now(),
  origin: "remote:test",
})

describe("RemoteSync with injected Adapters", () => {
  it("starts, receives a subscribed event, and stops cleanly", async () => {
    const transport = createInMemoryRemoteTransport()
    const scheduler = createInMemoryScheduler({ initialNow: 0 })
    const projectID = `proj_remote_sync_${run}`
    const url = `https://remote.test/${run}`

    const handle = await RemoteSync.start({
      url,
      token: "tok",
      projectID,
      drainIntervalMs: 1000,
      transport,
      scheduler,
    })

    expect(handle).toBeDefined()
    expect(handle.status().connected).toBe(true)

    // Inject a remote event via the transport. Use the same projectID the
    // RemoteSync was started with, otherwise the local query below won't
    // see it.
    const remoteEvent = sample(1, "remote.injected")
    remoteEvent.projectId = projectID
    transport.enqueue(remoteEvent)
    await new Promise((resolve) => setTimeout(resolve, 30))

    // Local store now contains the replayed event with the remote origin tag
    const stored = await Sync.getEvents(projectID, remoteEvent.aggregate)
    expect(stored.find((e) => e.seq === 1)).toBeDefined()
    expect(stored.find((e) => e.seq === 1)?.origin).toMatch(/^remote:/)

    await handle.stop()
    expect(handle.status().connected).toBe(false)
  })

  it("drainInterval is driven by the scheduler", async () => {
    const transport = createInMemoryRemoteTransport()
    const scheduler = createInMemoryScheduler({ initialNow: 0 })
    const projectID = `proj_remote_sync_drain_${run}`

    // No events pushed yet — drain should be a no-op when nothing is enqueued.
    const handle = await RemoteSync.start({
      url: `https://remote.test/drain/${run}`,
      token: "tok",
      projectID,
      drainIntervalMs: 1000,
      transport,
      scheduler,
    })

    // Advance the fake clock past several intervals
    scheduler.tick(10_000)
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(transport.pushed).toHaveLength(0)

    await handle.stop()
  })
})
