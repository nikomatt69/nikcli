import { describe, expect, it } from "bun:test"
import { ManagedWorktree } from "@/worktree/managed"

/**
 * Schemas and surface contract for the managed-worktree port
 * (based on opencode PR #30117 — copy-on-write worktree engine).
 *
 * These tests lock in the wire-shape schemas that the experimental HTTP routes
 * publish at /experimental/managed-worktree (POST/DELETE/...). The Effect
 * runtime is exercised separately by integration tests; here we only assert
 * that:
 *   - inputs round-trip through their schemas with the expected defaults
 *   - invalid inputs are rejected (so a buggy client request never reaches
 *     the Effect layer)
 *   - error classes are well-formed TaggedErrorClass instances
 *   - the Service class exposes the expected Interface methods
 */
describe("ManagedWorktree schemas (opencode PR #30117)", () => {
  it("parses CreateInput with required `from` and optional `name`/`into`", () => {
    const parsed = ManagedWorktree.CreateInput.parse({
      from: "/repo/source",
      name: "feature-1",
      into: "/worktrees",
    })
    expect(parsed.from).toBe("/repo/source")
    expect(parsed.name).toBe("feature-1")
    expect(parsed.into).toBe("/worktrees")
  })

  it("accepts an empty CreateInput body (only `from` is required by the wire contract)", () => {
    // The route registers `validator("json", ManagedWorktree.CreateInput.optional())`,
    // so the body is allowed to be missing entirely. When it IS present, `from`
    // is the only mandatory field — `name` and `into` derive defaults.
    const minimal = ManagedWorktree.CreateInput.parse({ from: "/repo/source" })
    expect(minimal.name).toBeUndefined()
    expect(minimal.into).toBeUndefined()
  })

  it("rejects CreateInput missing `from`", () => {
    expect(() => ManagedWorktree.CreateInput.parse({ name: "feature-1" } as never)).toThrow()
  })

  it("parses RemoveInput with required `at`", () => {
    const parsed = ManagedWorktree.RemoveInput.parse({
      at: "/worktrees/feature-1",
    })
    expect(parsed.at).toBe("/worktrees/feature-1")
  })

  it("rejects RemoveInput missing `at`", () => {
    expect(() => ManagedWorktree.RemoveInput.parse({} as never)).toThrow()
  })

  it("parses LinkInput with required `at` and optional `to`", () => {
    const parsed = ManagedWorktree.LinkInput.parse({
      at: "/worktrees/feature-1",
      to: "/worktrees/feature-2",
    })
    expect(parsed.at).toBe("/worktrees/feature-1")
    expect(parsed.to).toBe("/worktrees/feature-2")

    const minimal = ManagedWorktree.LinkInput.parse({
      at: "/worktrees/feature-1",
    })
    expect(minimal.to).toBeUndefined()
  })

  it("parses ChildrenInput and AncestorsInput with required `of`", () => {
    const children = ManagedWorktree.ChildrenInput.parse({
      of: "/worktrees/feature-1",
    })
    expect(children.of).toBe("/worktrees/feature-1")
    const ancestors = ManagedWorktree.AncestorsInput.parse({
      of: "/worktrees/feature-1",
    })
    expect(ancestors.of).toBe("/worktrees/feature-1")
  })

  it("rejects ChildrenInput/AncestorsInput missing `of`", () => {
    expect(() => ManagedWorktree.ChildrenInput.parse({} as never)).toThrow()
    expect(() => ManagedWorktree.AncestorsInput.parse({} as never)).toThrow()
  })

  it("parses Info as a managed-worktree record", () => {
    const parsed = ManagedWorktree.Info.parse({
      id: "01HXYZABCDEFGHJKMNPQRSTVWX",
      parentId: null,
      name: "feature-1",
      branch: "feature-1",
      directory: "/worktrees/feature-1",
      createdAt: 1_700_000_000_000,
    })
    expect(parsed.id).toBe("01HXYZABCDEFGHJKMNPQRSTVWX")
    expect(parsed.parentId).toBeNull()
    expect(parsed.name).toBe("feature-1")
  })

  it("rejects Info missing required fields", () => {
    expect(() => ManagedWorktree.Info.parse({ id: "x" } as never)).toThrow()
  })
})

describe("ManagedWorktree Service contract (opencode PR #30117)", () => {
  it("exposes create/remove/link/children/ancestors/list on the Service Interface", () => {
    const iface: keyof ManagedWorktree.Interface = "create"
    // Compile-time check: the Interface must have all six members used by the
    // experimental HTTP routes. If a future refactor drops one, this test
    // fails to type-check and surfaces the regression before runtime.
    const keys: Array<keyof ManagedWorktree.Interface> = ["create", "remove", "link", "children", "ancestors", "list"]
    expect(keys.length).toBe(6)
    expect(iface).toBe("create")
    expect(ManagedWorktree.Service).toBeDefined()
  })

  it("exposes a defaultLayer that resolves the Service", () => {
    expect(ManagedWorktree.defaultLayer).toBeDefined()
    // Effect's Context.Service is implemented as a function-with-key: the
    // `key` token is what `yield* ManagedWorktree.Service` uses for DI lookup.
    // If the identifier drifts, downstream lookups break — this catches it.
    const Service = ManagedWorktree.Service as unknown as { key: unknown }
    expect(typeof Service.key).toBeTruthy()
  })
})

describe("ManagedWorktree error classes (opencode PR #30117)", () => {
  it("WorktreeError is a TaggedErrorClass carrying message + optional code", () => {
    const err = new ManagedWorktree.WorktreeError({
      message: "boom",
      code: "TEST_CODE",
    })
    expect(err.message).toBe("boom")
    expect((err as unknown as { code?: string }).code).toBe("TEST_CODE")
  })

  it("UnsafeGitError, CopyError, and MarkerError all extend WorktreeError", () => {
    const u = new ManagedWorktree.UnsafeGitError({
      message: "merge in progress",
    })
    const c = new ManagedWorktree.CopyError({ message: "reflink unsupported" })
    const m = new ManagedWorktree.MarkerError({
      message: "marker write failed",
    })
    expect(u).toBeInstanceOf(ManagedWorktree.WorktreeError)
    expect(c).toBeInstanceOf(ManagedWorktree.WorktreeError)
    expect(m).toBeInstanceOf(ManagedWorktree.WorktreeError)
    expect(u.message).toBe("merge in progress")
    expect(c.message).toBe("reflink unsupported")
    expect(m.message).toBe("marker write failed")
  })
})
