/**
 * Lightweight shared types between `workspace/index.ts` and
 * `workspace/connection.ts` to avoid a circular import. Anything the
 * connection module needs to know about a workspace is declared here.
 */
import type { Config } from "./config"

export type WorkspaceInfo = {
  id: string
  name: string
  timeUsed: number
  branch: string | null
  projectID: string
  config: Config
}

export type WorkspaceTarget =
  | { type: "local"; directory: string }
  | { type: "remote"; url: string | URL; headers?: HeadersInit }
