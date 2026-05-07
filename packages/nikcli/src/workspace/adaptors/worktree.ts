import { existsSync } from "fs"
import path from "path"
import { Worktree } from "@/worktree"
import type { Config } from "../config"
import type { Adaptor } from "./types"
import { Log } from "@/util/log"
import { runPromiseWithLayer, withCurrentInstance } from "@/effect"
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
