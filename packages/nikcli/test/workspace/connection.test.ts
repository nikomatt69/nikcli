import { afterAll, describe, expect, it } from "bun:test"

const { WorkspaceConnection } = await import("@/workspace/connection")

const run = Math.random().toString(36).slice(2)

afterAll(() => {
  WorkspaceConnection.stopAll()
})

describe("WorkspaceConnection", () => {
  it("starts as disconnected and reflects in-memory status", () => {
    const id = `wrk_disconnected_${run}`
    expect(WorkspaceConnection.status(id)).toBe("disconnected")
    expect(WorkspaceConnection.current(id)).toBeUndefined()

    WorkspaceConnection.set(id, "connected")
    expect(WorkspaceConnection.current(id)).toBe("connected")

    WorkspaceConnection.forget(id)
    expect(WorkspaceConnection.current(id)).toBeUndefined()
    expect(WorkspaceConnection.status(id)).toBe("disconnected")
  })

  it("skips start() for local worktree configs", () => {
    const sampleSpace = {
      id: `wrk_connection_${run}`,
      name: "connection-test",
      timeUsed: Date.now(),
      branch: null,
      projectID: `proj_connection_${run}`,
      config: {
        type: "worktree" as const,
        directory: "/tmp/nikcli-connection-test",
      },
    }
    WorkspaceConnection.start(sampleSpace, {
      type: "local",
      directory: sampleSpace.config.directory,
    })
    expect(WorkspaceConnection.current(sampleSpace.id)).toBeUndefined()
  })

  it("stopAll is a safe no-op when nothing is running", () => {
    expect(() => WorkspaceConnection.stopAll()).not.toThrow()
  })

  it("does not export an unmanaged `workspaceEvents` replay helper", async () => {
    const mod = (await import("@/workspace/sync-bridge")) as unknown as Record<string, unknown>
    expect("workspaceEvents" in mod).toBe(false)
  })
})
