import type { Config } from "../config"

export type Target = { type: "local"; directory: string } | { type: "remote"; url: string | URL; headers?: HeadersInit }

export type Adaptor<T extends Config = Config> = {
  create(from: T, branch?: string | null, workspaceID?: string): Promise<{ config: T; init: () => Promise<void> }>
  remove(from: T): Promise<void>
  target(config: T): Target | Promise<Target>
  /**
   * Optional health check for the workspace.
   * Returns true if healthy, false or throws if unhealthy.
   */
  healthCheck?(config: T): Promise<boolean> | boolean
}
