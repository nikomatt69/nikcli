import type { Config } from "../config"

export type Target = { type: "local"; directory: string } | { type: "remote"; url: string | URL; headers?: HeadersInit }

/**
 * A workspace discovered by an adaptor's `list()` that is not (yet) tracked in
 * the workspace DB. Mirrors opencode's `WorkspaceListedInfo`: the adaptor
 * enumerates live state (e.g. `git worktree list`) and `Workspace.syncList`
 * merges anything new into the DB, keyed by `name`.
 */
export type ListedWorkspace<T extends Config = Config> = {
  type: T["type"]
  name: string
  branch: string | null
  config: T
}

export type Adaptor<T extends Config = Config> = {
  /** Display name for the adaptor (shown in the create picker). */
  name: string
  /** One-line description for the adaptor. */
  description: string
  create(
    from: T,
    branch?: string | null,
    workspaceID?: string,
  ): Promise<{ config: T; init: () => Promise<void>; name?: string }>
  /**
   * Optional discovery: enumerate workspaces that exist for the current project
   * but may not be tracked in the DB yet (e.g. git worktrees). Used by
   * `Workspace.syncList` to auto-register them, the same way opencode does.
   */
  list?(): Promise<ListedWorkspace<T>[]>
  remove(from: T): Promise<void>
  target(config: T): Target | Promise<Target>
  /**
   * Optional health check for the workspace.
   * Returns true if healthy, false or throws if unhealthy.
   */
  healthCheck?(config: T): Promise<boolean> | boolean
}
