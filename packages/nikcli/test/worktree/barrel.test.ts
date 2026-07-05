import { describe, expect, it } from "bun:test"

/**
 * Boundary assertion: `Worktree` is the stable surface, `ManagedWorktree` is
 * an experimental copy-on-write engine that must be imported directly from
 * `../worktree/managed` to be reached.
 *
 * If you ever re-export ManagedWorktree from the barrel, this test fails
 * — which is the signal to decide between quarantine and unify behind the
 * `Worktree.Service` interface, not to silently expose a second module.
 */
describe("Worktree barrel boundary", () => {
  it("does not re-export ManagedWorktree from the stable barrel", async () => {
    const barrel = await import("@/worktree")
    expect("ManagedWorktree" in barrel).toBe(false)
  })

  it("keeps ManagedWorktree reachable only via the direct module path", async () => {
    const direct = await import("@/worktree/managed")
    expect(direct.ManagedWorktree).toBeDefined()
    expect(direct.ManagedWorktree.Service).toBeDefined()
    expect(direct.ManagedWorktree.defaultLayer).toBeDefined()
  })

  it("still exposes the stable Worktree surface", async () => {
    const barrel = await import("@/worktree")
    expect(barrel.Worktree.Service).toBeDefined()
    expect(barrel.Worktree.Info).toBeDefined()
    expect(barrel.Worktree.defaultLayer).toBeDefined()
  })
})
