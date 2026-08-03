import { preserveTestEnv } from "../helpers/env"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { afterAll, describe, expect, it } from "bun:test"
import z from "zod"

const testDir = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-sync-events-"))
process.env.NIKCLI_TEST_HOME = testDir
process.env.NIKCLI_DB = path.join(testDir, "nikcli.db")
process.env.XDG_DATA_HOME = path.join(testDir, "data")

preserveTestEnv(["NIKCLI_TEST_HOME", "NIKCLI_DB", "XDG_DATA_HOME"])

const { SyncEvents } = await import("@/sync/events")
const { Sync } = await import("@/sync")
import type { SyncEventRecord } from "@/sync"

const run = Math.random().toString(36).slice(2)

afterAll(async () => {
  if (process.env.NIKCLI_DB === path.join(testDir, "nikcli.db")) {
    await fs.rm(testDir, { recursive: true, force: true })
  }
})

describe("SyncEvents taxonomy", () => {
  it("exposes every registered application event in `all` with a unique type", () => {
    const types = SyncEvents.all.map((d) => d.type)
    expect(new Set(types).size).toBe(types.length)
    expect(types).toContain("workspace.created")
    expect(types).toContain("workspace.removed")
    expect(types).toContain("workspace.configUpdated")
    expect(types).toContain("workspace.statusChanged")
    expect(types).toContain("sync_unify.workspace_migrated")
  })

  it("ofType predicate only matches the registered type literal", () => {
    expect(
      SyncEvents.ofType(SyncEvents.E.Workspace.created)({
        type: "workspace.created",
      }),
    ).toBe(true)
    expect(
      SyncEvents.ofType(SyncEvents.E.Workspace.created)({
        type: "workspace.removed",
      }),
    ).toBe(false)
    expect(SyncEvents.ofType(SyncEvents.E.Workspace.created)({})).toBe(false)
  })

  it("emits a typed workspace.created and persists the typed payload", async () => {
    const projectID = `proj_sync_events_created_${run}`
    const workspaceID = `wrk_sync_events_created_${run}`

    const record = await SyncEvents.emit(projectID, workspaceID, SyncEvents.E.Workspace.created, {
      name: "events-test",
      branch: "feature/taxonomy",
      config: { type: "worktree", directory: "/tmp/events-test" },
      timeUsed: 42,
    })

    expect(record.type).toBe("workspace.created")
    expect(record.aggregate).toBe(workspaceID)

    const stored: SyncEventRecord[] = await Sync.getEvents(projectID, workspaceID)
    expect(stored).toHaveLength(1)
    expect(stored[0].data).toMatchObject({
      type: "workspace.created",
      name: "events-test",
      branch: "feature/taxonomy",
      timeUsed: 42,
    })
  })

  it("emits a workspace.removed through the registry and emits both events in order", async () => {
    const projectID = `proj_sync_events_removed_${run}`
    const workspaceID = `wrk_sync_events_removed_${run}`

    await SyncEvents.emit(projectID, workspaceID, SyncEvents.E.Workspace.created, {
      name: "removed-test",
      branch: null,
      config: { type: "worktree", directory: "/tmp/removed-test" },
    })
    const removed = await SyncEvents.emit(projectID, workspaceID, SyncEvents.E.Workspace.removed, {})
    expect(removed.type).toBe("workspace.removed")

    const stored: SyncEventRecord[] = await Sync.getEvents(projectID, workspaceID)
    expect(stored).toHaveLength(2)
    expect(stored.map((e) => e.type)).toEqual(["workspace.created", "workspace.removed"])
  })

  it("falls back to a tagged payload when schema validation fails", async () => {
    const projectID = `proj_sync_events_invalid_${run}`
    const workspaceID = `wrk_sync_events_invalid_${run}`

    // `statusChanged` requires `status: string`. Pass `null` to force the
    // Zod safeParse to fail and trigger the fallback payload.
    const def = SyncEvents.E.Workspace.statusChanged
    const record = await SyncEvents.emit(projectID, workspaceID, def, null as never)

    expect(record.type).toBe("workspace.statusChanged")
    const stored: SyncEventRecord[] = await Sync.getEvents(projectID, workspaceID)
    expect(stored.length).toBeGreaterThan(0)
    const data = stored[0].data as Record<string, unknown>
    expect(data._schemaError).toBeDefined()
    expect(data.payload).toBeNull()
  })

  it("define() produces a frozen registry entry", () => {
    const def = SyncEvents.define("custom.test", z.object({ n: z.number() }), "project")
    expect(def.type).toBe("custom.test")
    expect(() => {
      // @ts-expect-error verify freeze at runtime
      def.type = "mutated"
    }).toThrow()
  })
})
