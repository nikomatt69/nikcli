import { existsSync } from "fs"
import path from "path"
import { Worktree } from "@/worktree"
import type { Config } from "../config"
import type { Adaptor, ListedWorkspace } from "./types"
import { Log } from "@nikcli-ai/util/log"
import { runPromiseWithLayer, locallyInstance, InstanceState, type InstanceContext } from "@/effect"
import { Effect } from "effect"

const log = Log.create({ service: "worktree.adaptor" })

type WorktreeConfig = Extract<Config, { type: "worktree" }>

function runWorktree<A, E>(instance: InstanceContext, effect: Effect.Effect<A, E, Worktree.Service>) {
  return runPromiseWithLayer(Worktree.defaultLayer, locallyInstance(instance, effect))
}

export const WorktreeAdaptor: Adaptor<WorktreeConfig> = {
  name: "Project copy",
  description: "Create a local git worktree",
  async create(_from: WorktreeConfig, branch: string | null | undefined, _workspaceID?: string) {
    // Never detached by default: without an explicit branch the worktree gets
    // the generated `nikcli/<name>` branch. A workspace is something you switch
    // to, and a detached worktree has no branch to switch to, so warping would
    // look like a no-op in git.
    //
    // opencode v2's detached-at-HEAD behaviour belongs to `ProjectCopy`, which
    // is a different concept and passes `detached: true` itself.
    const instance = InstanceState.ambient()
    const next = await runWorktree(
      instance,
      Effect.gen(function* () {
        const worktree = yield* Worktree.Service
        return yield* worktree.makeWorktreeInfo({
          name: _from.name,
          branch: branch ?? undefined,
        })
      }),
    )
    return {
      name: next.name,
      branch: next.branch ?? null,
      config: {
        type: "worktree",
        directory: next.directory,
        name: next.name,
        eventLimit: _from.eventLimit,
      },
      // Bound to the instance that created the worktree, not to whatever is
      // ambient when the caller gets around to running `init`.
      init: () =>
        runWorktree(
          instance,
          Effect.gen(function* () {
            const worktree = yield* Worktree.Service
            yield* worktree.createFromInfo(next)
          }),
        ),
    }
  },
  // Auto-discovery: enumerate the project's git worktrees (excluding the primary
  // working copy) so `Workspace.syncList` can register any that aren't tracked
  // in the DB yet — mirroring opencode's worktree adapter `list()`.
  async list(): Promise<ListedWorkspace<WorktreeConfig>[]> {
    const ctx = InstanceState.ambient()
    const result = await runWorktree(
      ctx,
      Effect.gen(function* () {
        if (ctx.project.vcs !== "git") return [] as ListedWorkspace<WorktreeConfig>[]
        const worktree = yield* Worktree.Service
        const entries = yield* worktree.list()
        const primary = path.resolve(ctx.worktree)
        return entries
          .filter((entry) => path.resolve(entry.directory) !== primary)
          .map(
            (entry): ListedWorkspace<WorktreeConfig> => ({
              type: "worktree",
              name: entry.name,
              branch: entry.branch || null,
              config: { type: "worktree", directory: entry.directory },
            }),
          )
      }),
    ).catch((error) => {
      log.warn("worktree adaptor list failed", { error })
      return [] as ListedWorkspace<WorktreeConfig>[]
    })
    return result
  },
  async remove(config: WorktreeConfig) {
    await runWorktree(
      InstanceState.ambient(),
      Effect.gen(function* () {
        const worktree = yield* Worktree.Service
        return yield* worktree.remove({ directory: config.directory })
      }),
    )
  },
  target(config: WorktreeConfig) {
    return { type: "local" as const, directory: config.directory }
  },
  async healthCheck(config: WorktreeConfig) {
    const gitDir = path.join(config.directory, ".git")
    if (!existsSync(gitDir)) {
      log.warn("healthCheck: .git not found", { directory: config.directory })
      return false
    }
    log.debug("healthCheck: passed", { directory: config.directory })
    return true
  },
}
