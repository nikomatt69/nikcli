import { existsSync } from "fs"
import path from "path"
import { Worktree } from "@/worktree"
import { Project } from "@/project/project"
import type { Config } from "../config"
import type { Adaptor } from "./types"
import { Log } from "@/util/log"
import { runPromiseWithLayer, withCurrentInstance, InstanceState } from "@/effect"
import { Effect } from "effect"

const log = Log.create({ service: "worktree.adaptor" })

type WorktreeConfig = Extract<Config, { type: "worktree" }>

function runWorktree<A, E>(effect: Effect.Effect<A, E, Worktree.Service>) {
  return runPromiseWithLayer(Worktree.defaultLayer, withCurrentInstance(effect))
}

export const WorktreeAdaptor: Adaptor<WorktreeConfig> = {
  async create(_from: WorktreeConfig, branch: string | null | undefined, _workspaceID?: string) {
    const next = await runWorktree(
      Effect.gen(function* () {
        const worktree = yield* Worktree.Service
        return yield* worktree.create(branch ? { branch } : undefined)
      }),
    )
    // Track the new worktree as a project directory ("working copy") so it shows up
    // in workspace/move listings immediately, the same way opencode tracks project copies.
    // Best-effort: never block worktree creation if tracking fails.
    await runPromiseWithLayer(
      Project.defaultLayer,
      withCurrentInstance(
        Effect.gen(function* () {
          const project = yield* Project.Service
          yield* project.fromDirectory(next.directory)
        }),
      ),
    ).catch((error) => log.warn("failed to track worktree as project directory", { directory: next.directory, error }))
    return {
      config: {
        type: "worktree",
        directory: next.directory,
        eventLimit: _from.eventLimit,
      },
      init: async () => {},
    }
  },
  async remove(config: WorktreeConfig) {
    await runWorktree(
      Effect.gen(function* () {
        const worktree = yield* Worktree.Service
        return yield* worktree.remove({ directory: config.directory })
      }),
    )
    // Untrack the worktree directory from the project, mirroring opencode's copy lifecycle.
    await runPromiseWithLayer(
      Project.defaultLayer,
      withCurrentInstance(
        Effect.gen(function* () {
          const ctx = yield* InstanceState.context
          const project = yield* Project.Service
          yield* project.removeSandbox(ctx.project.id, config.directory)
        }),
      ),
    ).catch((error) => log.warn("failed to untrack worktree directory", { directory: config.directory, error }))
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
