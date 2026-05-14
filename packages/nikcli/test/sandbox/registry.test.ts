import { beforeEach, describe, expect, it } from "bun:test"
import { Sandbox } from "@/sandbox/types"
import { SandboxRegistry, NotFoundError } from "@/sandbox/registry"

describe("sandbox types", () => {
  describe("Ref schema", () => {
    it("parses local ref", () => {
      const ref = Sandbox.Ref.parse({ type: "local", directory: "/test/dir" })
      expect(ref.type).toBe("local")
      if (ref.type === "local") {
        expect(ref.directory).toBe("/test/dir")
      }
    })

    it("parses workspace ref", () => {
      const ref = Sandbox.Ref.parse({ type: "workspace", workspaceID: "wrk_123" })
      expect(ref.type).toBe("workspace")
      if (ref.type === "workspace") {
        expect(ref.workspaceID).toBe("wrk_123")
      }
    })

    it("rejects invalid ref", () => {
      expect(() => Sandbox.Ref.parse({ type: "invalid" as any })).toThrow()
    })
  })

  describe("State schema", () => {
    it("parses local state", () => {
      const state = Sandbox.State.parse({ kind: "local" })
      expect(state.kind).toBe("local")
    })

    it("parses worktree state", () => {
      const state = Sandbox.State.parse({ kind: "worktree", workspaceID: "wrk_123" })
      expect(state.kind).toBe("worktree")
      if (state.kind === "worktree") {
        expect(state.workspaceID).toBe("wrk_123")
      }
    })

    it("parses container state", () => {
      const state = Sandbox.State.parse({
        kind: "container",
        workspaceID: "wrk_123",
        serverURL: "http://localhost:8080",
      })
      expect(state.kind).toBe("container")
      if (state.kind === "container") {
        expect(state.serverURL).toBe("http://localhost:8080")
        expect(state.workspaceID).toBe("wrk_123")
      }
    })
  })
})

describe("SandboxRegistry", () => {
  beforeEach(() => {
    // Clear cache before each test
    SandboxRegistry.clearCache()
  })

  describe("refForSession", () => {
    it("returns workspace ref when workspaceID present", () => {
      const ref = SandboxRegistry.refForSession({
        directory: "/test",
        workspaceID: "wrk_123",
      })
      expect(ref.type).toBe("workspace")
      if (ref.type === "workspace") {
        expect(ref.workspaceID).toBe("wrk_123")
      }
    })

    it("returns local ref when no workspaceID", () => {
      const ref = SandboxRegistry.refForSession({
        directory: "/test/dir",
        workspaceID: undefined,
      })
      expect(ref.type).toBe("local")
      if (ref.type === "local") {
        expect(ref.directory).toBe("/test/dir")
      }
    })
  })

  describe("resolve - local", () => {
    it("returns local handle without workspace lookup", async () => {
      const handle = await SandboxRegistry.resolve({ type: "local", directory: "/test/dir" })
      expect(handle.directory).toBe("/test/dir")
      expect(handle.state.kind).toBe("local")
      expect(handle.ref.type).toBe("local")
    })

    it("target() returns local target", async () => {
      const handle = await SandboxRegistry.resolve({ type: "local", directory: "/test/dir" })
      const target = await handle.target()
      expect(target.type).toBe("local")
      if (target.type === "local") {
        expect(target.directory).toBe("/test/dir")
      }
    })
  })

  describe("NotFoundError", () => {
    it("creates error with workspaceID", () => {
      const error = new NotFoundError({ workspaceID: "wrk_123" })
      expect(error.name).toBe("SandboxNotFoundError")
      expect(error.workspaceID).toBe("wrk_123")
    })
  })
})
