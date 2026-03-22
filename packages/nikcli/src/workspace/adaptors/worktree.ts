import { Worktree } from "@/worktree"
import type { Config } from "../config"
import type { Adaptor } from "./types"

type WorktreeConfig = Extract<Config, { type: "worktree" }>

export const WorktreeAdaptor: Adaptor<WorktreeConfig> = {
  async create(_from: WorktreeConfig, branch: string | null | undefined, _workspaceID?: string) {
    const next = await Worktree.create(branch ? { branch } : undefined)
    return {
      config: {
        type: "worktree",
        directory: next.directory,
      },
      init: async () => {},
    }
  },
  async remove(config: WorktreeConfig) {
    await Worktree.remove({ directory: config.directory })
  },
  async request(
    _from: WorktreeConfig,
    _method: string,
    _url: string,
    _data?: BodyInit,
    _signal?: AbortSignal,
    _headers?: HeadersInit,
  ) {
    throw new Error("worktree does not support request")
  },
}
