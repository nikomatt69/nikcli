/**
 * Run sandboxes — one git worktree per unattended runner.
 *
 * Loops (`src/loop/engine.ts`) and missions (`src/mission/orchestrator.ts`)
 * drive an agent with nobody watching. Running them straight in the user's
 * checkout means an autonomous agent edits the files the user is editing, so
 * every sandboxed runner gets its own `git worktree` on its own branch and its
 * sessions are created bound to that directory. The user's working copy is
 * never touched; the work is reviewable as a branch (and, for loops with
 * `createPR`, as a PR).
 *
 * Isolation is what makes "full access" safe: an unattended run cannot answer
 * a permission prompt, so it runs with `PermissionRuleset.fullAccess()`. The
 * worktree is the boundary that keeps that from being a blanket grant over the
 * user's checkout.
 *
 * Contract:
 *   - `ensure` never throws. A non-git project (or any worktree failure)
 *     resolves to `undefined` and the caller falls back to the host directory
 *     un-sandboxed — a run must never be blocked by sandboxing.
 *   - The sandbox is **reused** across runs of the same loop/mission so
 *     successive iterations build on each other, and is re-created only when
 *     the recorded directory has disappeared.
 *   - `release` is deliberately conservative: it removes the worktree only
 *     when there is nothing to lose (clean tree, no commits ahead of the base
 *     branch). A sandbox holding real work outlives the definition that
 *     created it and is left for the user to merge or delete.
 */

import fs from "fs/promises"
import path from "path"
import { Effect } from "effect"
import { Git } from "@/git"
import { Log } from "@/util/log"
import { withInstance } from "@/effect"
import { Worktree } from "./index"

const log = Log.create({ service: "worktree.sandbox" })

export namespace RunSandbox {
  /**
   * Sandboxes live *inside* the project, under `.nikcli/.worktrees/`, so a
   * user can see (and `cd` into) what their loops and missions are doing
   * without hunting through a global data directory. The worktree service
   * drops a self-ignoring `.gitignore` in that root, so the sandboxes never
   * show up in the parent repo's `git status`.
   */
  export const ROOT = path.join(".nikcli", ".worktrees")

  /** Directory prefix for every sandbox, e.g. `worktree-loop-nightly-qa`. */
  export const PREFIX = "worktree"

  /**
   * Recorded on the loop/mission definition so a restart (or a later run in a
   * different process) rebinds to the same worktree instead of spawning a new
   * one every tick.
   */
  export type Info = {
    name: string
    branch?: string
    directory: string
  }

  export type EnsureInput = {
    /** The project directory the runner was defined in. */
    hostDirectory: string
    /** Human-ish base name; uniqueness is handled by the worktree service. */
    name: string
    /** Branch namespace, e.g. `nikcli/loop`. */
    branchPrefix: string
    /** Previously created sandbox to reuse, if it still exists on disk. */
    existing?: Info
  }

  function runWorktree<A, E>(directory: string, effect: Effect.Effect<A, E, Worktree.Service>) {
    return withInstance({ directory }, Effect.provide(effect, Worktree.defaultLayer))
  }

  async function isCheckout(directory: string): Promise<boolean> {
    // A linked worktree has a `.git` *file* pointing at the common dir; a
    // plain directory left behind by a partial cleanup does not.
    return fs
      .stat(path.join(directory, ".git"))
      .then(() => true)
      .catch(() => false)
  }

  /**
   * Resolve the sandbox for a runner, creating the worktree on first use and
   * reusing it afterwards. Returns `undefined` when the project cannot be
   * sandboxed (not a git repo, worktree creation failed) — the caller then
   * runs in the host directory.
   */
  export async function ensure(input: EnsureInput): Promise<Info | undefined> {
    if (input.existing && (await isCheckout(input.existing.directory))) return input.existing
    if (input.existing) {
      log.info("sandbox worktree missing; recreating", {
        directory: input.existing.directory,
      })
    }

    try {
      const created = await runWorktree(
        input.hostDirectory,
        Effect.gen(function* () {
          const service = yield* Worktree.Service
          return yield* service.create({
            name: `${PREFIX}-${input.name}`,
            branchPrefix: input.branchPrefix,
            root: ROOT,
          })
        }),
      )
      log.info("created sandbox worktree", {
        name: created.name,
        branch: created.branch,
        directory: created.directory,
      })
      return {
        name: created.name,
        directory: created.directory,
        ...(created.branch ? { branch: created.branch } : {}),
      }
    } catch (error) {
      if (error instanceof Worktree.NotGitError) {
        log.info("sandbox skipped: project is not a git repo", {
          directory: input.hostDirectory,
        })
        return undefined
      }
      log.warn("failed to create sandbox worktree; running in the host directory", {
        directory: input.hostDirectory,
        error: error instanceof Error ? error.message : String(error),
      })
      return undefined
    }
  }

  /** True when the worktree has no uncommitted changes and no commits of its own. */
  async function isDisposable(directory: string): Promise<boolean> {
    const status = await Git.run(["-c", "core.fsmonitor=false", "status", "--porcelain=v1"], { cwd: directory })
    if (status.exitCode !== 0) return false
    if (status.text().trim()) return false

    const base = await Git.defaultBranch(directory)
    if (!base) return false
    const ahead = await Git.run(["rev-list", "--count", `${base.ref}..HEAD`], { cwd: directory })
    if (ahead.exitCode !== 0) return false
    return ahead.text().trim() === "0"
  }

  /**
   * Drop a sandbox whose owning loop/mission is gone. Keeps the worktree when
   * it still holds work (dirty tree or commits ahead of the base branch) so
   * deleting a definition can never silently destroy an agent's output.
   *
   * Returns true when the worktree was actually removed.
   */
  export async function release(input: { hostDirectory: string; sandbox: Info }): Promise<boolean> {
    const { directory } = input.sandbox
    if (!(await isCheckout(directory))) return false
    if (!(await isDisposable(directory))) {
      log.info("keeping sandbox worktree: it still holds work", { directory })
      return false
    }
    try {
      await runWorktree(
        input.hostDirectory,
        Effect.gen(function* () {
          const service = yield* Worktree.Service
          return yield* service.remove({ directory })
        }),
      )
      log.info("removed sandbox worktree", { directory })
      return true
    } catch (error) {
      log.warn("failed to remove sandbox worktree", {
        directory,
        error: error instanceof Error ? error.message : String(error),
      })
      return false
    }
  }
}
