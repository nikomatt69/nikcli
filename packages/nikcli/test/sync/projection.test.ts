import fs from "fs/promises"
import os from "os"
import path from "path"
import { afterAll, describe, expect, it } from "bun:test"
import { Hono } from "hono"

const testDir = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-sync-projection-"))
process.env.NIKCLI_TEST_HOME ??= testDir
process.env.NIKCLI_DB ??= path.join(testDir, "nikcli.db")

const { Sync } = await import("@/sync")
const { SyncProjection } = await import("@/sync/projection")
const { SyncSnapshot } = await import("@/sync/snapshot")
const { SyncRoutes } = await import("@/server/routes/sync")

const run = Math.random().toString(36).slice(2)
const projectID = `proj_projection_${run}`

afterAll(async () => {
  await fs.rm(testDir, { recursive: true, force: true })
})

describe("SyncProjection", () => {
  it("projects a session aggregate from journaled events and persists a snapshot", async () => {
    const sessionID = `ses_projection_${run}`

    await Sync.emitRaw(projectID, sessionID, {
      type: "session.created",
      properties: { sessionID, title: "First title" },
    })
    await Sync.emitRaw(projectID, sessionID, {
      type: "session.updated",
      properties: { sessionID, title: "Renamed" },
    })
    await Sync.emitRaw(projectID, sessionID, {
      type: "session.idle",
      properties: { sessionID },
    })

    const { state, lastSeq } = await SyncProjection.session(projectID, sessionID)
    expect(lastSeq).toBe(3)
    expect(state.id).toBe(sessionID)
    expect(state.title).toBe("Renamed")

    // First replay persists the snapshot; the next read starts from it.
    const snapshot = SyncSnapshot.load({ projectID, aggregate: sessionID, aggregateID: sessionID })
    expect(snapshot?.lastSeq).toBe(3)

    const again = await SyncProjection.session(projectID, sessionID)
    expect(again.lastSeq).toBe(3)
    expect(again.state.title).toBe("Renamed")
  })

  it("dispatches by aggregate prefix and rejects unknown kinds", async () => {
    const workspaceID = `wrk_projection_${run}`
    await Sync.emitRaw(projectID, workspaceID, {
      type: "workspace.created",
      name: "space",
      branch: "main",
      config: { type: "worktree" },
    })

    const workspace = await SyncProjection.byAggregate(projectID, workspaceID)
    expect((workspace?.state as any)?.name).toBe("space")

    expect(await SyncProjection.byAggregate(projectID, "foo_unknown")).toBeUndefined()
  })
})

describe("GET /sync/snapshot/:aggregateID", () => {
  const app = new Hono().route("/sync", SyncRoutes)

  it("returns the projected state for a session aggregate", async () => {
    const sessionID = `ses_route_${run}`
    await Sync.emitRaw(projectID, sessionID, {
      type: "session.created",
      properties: { sessionID, title: "Via route" },
    })

    const res = await app.request(`http://localhost/sync/snapshot/${sessionID}?projectID=${projectID}`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { lastSeq: number; state: { title: string } }
    expect(body.lastSeq).toBe(1)
    expect(body.state.title).toBe("Via route")
  })

  it("rejects unsupported aggregate kinds", async () => {
    const res = await app.request(`http://localhost/sync/snapshot/foo_unknown?projectID=${projectID}`)
    expect(res.status).toBe(400)
  })
})
