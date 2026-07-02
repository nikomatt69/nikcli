import fs from "fs/promises"
import os from "os"
import path from "path"
import { afterAll, describe, expect, it } from "bun:test"

const testDir = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-sync-backend-"))
process.env.NIKCLI_TEST_HOME ??= testDir
process.env.NIKCLI_DB ??= path.join(testDir, "nikcli.db")

const { SyncBackend } = await import("@/sync")

// Unique ids per run so the assertions hold even when the process-wide
// database singleton was already opened by another test file.
const run = Math.random().toString(36).slice(2)
const projectID = `proj_sync_backend_${run}`

afterAll(async () => {
  await fs.rm(testDir, { recursive: true, force: true })
})

describe("SyncBackend", () => {
  it("appends events with monotonic sequence numbers", async () => {
    const aggregate = `wrk_${run}_seq`

    const first = await SyncBackend.append(projectID, aggregate, { type: "session.created", properties: { id: "a" } })
    const second = await SyncBackend.append(projectID, aggregate, { type: "session.updated", properties: { id: "a" } })

    expect(first.seq).toBe(1)
    expect(second.seq).toBe(2)
    expect(await SyncBackend.latest(projectID, aggregate)).toBe(2)

    const records = await SyncBackend.records(projectID, aggregate)
    expect(records.map((record) => record.type)).toEqual(["session.created", "session.updated"])
    expect(records.map((record) => record.seq)).toEqual([1, 2])
  })

  it("supports incremental catch-up via fromSeq", async () => {
    const aggregate = `wrk_${run}_catchup`

    for (let i = 1; i <= 4; i++) {
      await SyncBackend.append(projectID, aggregate, { type: "session.status", properties: { sessionID: `s${i}` } })
    }

    const tail = await SyncBackend.records(projectID, aggregate, 2)
    expect(tail.map((record) => record.seq)).toEqual([3, 4])

    const payloads = await SyncBackend.payloads(projectID, aggregate, 3)
    expect(payloads).toEqual([{ type: "session.status", properties: { sessionID: "s4" } }])
  })

  it("trims the aggregate to the caller-provided limit", async () => {
    const aggregate = `wrk_${run}_limit`

    for (let i = 1; i <= 7; i++) {
      await SyncBackend.append(projectID, aggregate, { type: "session.idle", properties: { sessionID: `s${i}` } }, { limit: 5 })
    }

    const records = await SyncBackend.records(projectID, aggregate)
    expect(records).toHaveLength(5)
    // Oldest events were trimmed; sequence numbers keep increasing.
    expect(records[0].seq).toBe(3)
    expect(records.at(-1)?.seq).toBe(7)
    expect(await SyncBackend.latest(projectID, aggregate)).toBe(7)
  })

  it("clears a single aggregate without touching others", async () => {
    const keep = `wrk_${run}_keep`
    const drop = `wrk_${run}_drop`

    await SyncBackend.append(projectID, keep, { type: "session.created", properties: { id: "keep" } })
    await SyncBackend.append(projectID, drop, { type: "session.created", properties: { id: "drop" } })

    await SyncBackend.clear(projectID, drop)

    expect(await SyncBackend.records(projectID, drop)).toHaveLength(0)
    expect(await SyncBackend.latest(projectID, drop)).toBe(0)
    expect(await SyncBackend.records(projectID, keep)).toHaveLength(1)
  })
})
