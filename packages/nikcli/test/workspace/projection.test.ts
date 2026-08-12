import { preserveTestEnv } from "../helpers/env"
import { removeTestDir } from "../helpers/fs"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { afterAll, describe, expect, it } from "bun:test"

const testDir = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-workspace-projection-"))
process.env.NIKCLI_TEST_HOME = testDir
process.env.NIKCLI_DB = path.join(testDir, "nikcli.db")
process.env.XDG_DATA_HOME = path.join(testDir, "data")

preserveTestEnv(["NIKCLI_TEST_HOME", "NIKCLI_DB", "XDG_DATA_HOME"])

const { Sync } = await import("@/sync")
const { WorkspaceDB } = await import("@/workspace/db")
const { WorkspaceProjection } = await import("@/workspace/projection")
const { SyncUnifyMigration } = await import("@/sync/migrate-from-workspace")

const run = Math.random().toString(36).slice(2)

afterAll(async () => {
  if (process.env.NIKCLI_DB === path.join(testDir, "nikcli.db")) {
    await removeTestDir(testDir)
  }
})

describe("WorkspaceProjection", () => {
  it("emits workspace.created and projects it into the workspace row", async () => {
    const projectID = `proj_workspace_projection_create_${run}`
    const workspaceID = `wrk_projection_create_${run}`

    const result = await WorkspaceProjection.emitLifecycle(projectID, workspaceID, "workspace.created", {
      name: "projected-space",
      branch: "feature/projection",
      config: { type: "worktree", directory: "/tmp/projected-space" },
      timeUsed: 1234,
    })

    expect(result.record?.workspaceId).toBe(workspaceID)
    expect(result.info).toEqual({
      id: workspaceID,
      projectID,
      name: "projected-space",
      branch: "feature/projection",
      config: { type: "worktree", directory: "/tmp/projected-space" },
      timeUsed: 1234,
    })
    expect(WorkspaceDB.get(workspaceID)).toEqual(result.info)
  })

  it("reprojects config and status lifecycle events idempotently", async () => {
    const projectID = `proj_workspace_projection_update_${run}`
    const workspaceID = `wrk_projection_update_${run}`

    await WorkspaceProjection.emitLifecycle(projectID, workspaceID, "workspace.created", {
      name: "before",
      branch: "main",
      config: { type: "worktree", directory: "/tmp/before" },
      timeUsed: 2000,
    })
    await Sync.emitRaw(
      projectID,
      workspaceID,
      {
        type: "workspace.configUpdated",
        branch: "next",
        config: { type: "worktree", directory: "/tmp/after" },
      },
      { workspaceID },
    )
    await Sync.emitRaw(
      projectID,
      workspaceID,
      { type: "workspace.statusChanged", status: "connected" },
      { workspaceID },
    )

    const first = await WorkspaceProjection.project(projectID, workspaceID)
    const second = await WorkspaceProjection.project(projectID, workspaceID)

    expect(first.lastSeq).toBe(3)
    expect(second.lastSeq).toBe(3)
    expect(WorkspaceDB.get(workspaceID)).toEqual({
      id: workspaceID,
      projectID,
      name: "before",
      branch: "next",
      config: { type: "worktree", directory: "/tmp/after" },
      timeUsed: 2000,
    })
    expect(WorkspaceDB.getStatus(workspaceID)).toBe("connected")
  })

  it("keeps an explicitly cleared branch cleared across replay", async () => {
    const projectID = `proj_workspace_projection_clear_${run}`
    const workspaceID = `wrk_projection_clear_${run}`

    await WorkspaceProjection.emitLifecycle(projectID, workspaceID, "workspace.created", {
      name: "detached-space",
      branch: "feature/before-detach",
      config: { type: "worktree", directory: "/tmp/detached-space" },
      timeUsed: 2500,
    })
    await WorkspaceProjection.emitLifecycle(projectID, workspaceID, "workspace.configUpdated", {
      branch: null,
      config: { type: "worktree", directory: "/tmp/detached-space" },
    })

    expect((await WorkspaceProjection.project(projectID, workspaceID)).info?.branch).toBeNull()
    expect((await WorkspaceProjection.project(projectID, workspaceID)).info?.branch).toBeNull()
    expect(WorkspaceDB.get(workspaceID)?.branch).toBeNull()
  })

  it("projects workspace.removed by deleting the workspace row", async () => {
    const projectID = `proj_workspace_projection_remove_${run}`
    const workspaceID = `wrk_projection_remove_${run}`

    await WorkspaceProjection.emitLifecycle(projectID, workspaceID, "workspace.created", {
      name: "deleted-space",
      branch: null,
      config: { type: "worktree", directory: "/tmp/deleted-space" },
    })

    expect(WorkspaceDB.get(workspaceID)).toBeDefined()

    const removed = await WorkspaceProjection.emitLifecycle(projectID, workspaceID, "workspace.removed", {})

    expect(removed.removed).toBe(true)
    expect(WorkspaceDB.get(workspaceID)).toBeUndefined()
  })
})

describe("SyncUnifyMigration workspace projection", () => {
  it("backfills one project at a time and keeps each project idempotent", async () => {
    const projectA = `proj_workspace_migration_a_${run}`
    const projectB = `proj_workspace_migration_b_${run}`
    const workspaceA = `wrk_migration_a_${run}`
    const workspaceB = `wrk_migration_b_${run}`

    WorkspaceDB.upsert({
      id: workspaceA,
      projectID: projectA,
      name: "space-a",
      branch: "main",
      config: { type: "worktree", directory: "/tmp/space-a" },
      timeUsed: 3000,
    })
    WorkspaceDB.upsert({
      id: workspaceB,
      projectID: projectB,
      name: "space-b",
      branch: "dev",
      config: { type: "worktree", directory: "/tmp/space-b" },
      timeUsed: 4000,
    })

    expect(await SyncUnifyMigration.run(projectA)).toBe(1)
    expect(await SyncUnifyMigration.run(projectA)).toBe(0)
    expect(await Sync.readAggregate(workspaceA)).toHaveLength(1)
    expect(await Sync.readAggregate(workspaceB)).toHaveLength(0)

    expect(await SyncUnifyMigration.run(projectB)).toBe(1)
    expect(await Sync.readAggregate(workspaceB)).toHaveLength(1)
  })
})
