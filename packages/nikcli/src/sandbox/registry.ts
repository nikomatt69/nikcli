import { Schema } from "effect"
import { Session } from "@/session"
import { Workspace } from "@/workspace"
import { getAdaptor } from "@/workspace/adaptors"
import { Sandbox } from "./types"
import { Log } from "@/util/log"

const log = Log.create({ service: "sandbox.registry" })

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("SandboxNotFoundError", {
  workspaceID: Schema.String,
}) {}

// Simple LRU cache for workspace resolution (30s TTL)
interface CacheEntry {
  handle: Sandbox.Handle
  expires: number
}
const resolveCache = new Map<string, CacheEntry>()
const CACHE_TTL_MS = 30_000

function stateFromWorkspace(workspace: Workspace.Info): Sandbox.State {
  switch (workspace.config.type) {
    case "worktree":
      return {
        kind: "worktree",
        workspaceID: workspace.id,
      }
    case "container":
      return {
        kind: "container",
        workspaceID: workspace.id,
        serverURL: workspace.config.serverUrl,
      }
  }
}

export namespace SandboxRegistry {
  export function refForSession(input: Pick<Session.Info, "directory" | "workspaceID">): Sandbox.Ref {
    if (input.workspaceID) {
      log.debug("refForSession: workspace", { workspaceID: input.workspaceID })
      return {
        type: "workspace",
        workspaceID: input.workspaceID,
      }
    }

    log.debug("refForSession: local", { directory: input.directory })
    return {
      type: "local",
      directory: input.directory,
    }
  }

  export async function fromSession(input: Pick<Session.Info, "directory" | "workspaceID">): Promise<Sandbox.Handle> {
    log.debug("fromSession", { directory: input.directory, workspaceID: input.workspaceID })
    return resolve(refForSession(input))
  }

  export async function resolve(ref: Sandbox.Ref): Promise<Sandbox.Handle> {
    if (ref.type === "local") {
      log.debug("resolve: local", { directory: ref.directory })
      // Clean up expired cache entries
      const now = Date.now()
      for (const [key, entry] of resolveCache) {
        if (entry.expires < now) resolveCache.delete(key)
      }
      return {
        ref,
        state: { kind: "local" },
        directory: ref.directory,
        async target() {
          return {
            type: "local",
            directory: ref.directory,
          }
        },
      }
    }

    const cacheKey = `workspace:${ref.workspaceID}`
    const now = Date.now()
    const cached = resolveCache.get(cacheKey)
    if (cached && cached.expires > now) {
      log.debug("resolve: cached", { workspaceID: ref.workspaceID })
      return cached.handle
    }

    log.debug("resolve: workspace", { workspaceID: ref.workspaceID })
    const workspace = await Workspace.get(ref.workspaceID)
    if (!workspace) {
      log.error("workspace not found", { workspaceID: ref.workspaceID })
      throw new NotFoundError({ workspaceID: ref.workspaceID })
    }

    const adaptor = getAdaptor(workspace.config)
    const handle: Sandbox.Handle = {
      ref,
      state: stateFromWorkspace(workspace),
      directory: workspace.config.directory,
      workspaceID: workspace.id,
      async target() {
        return Promise.resolve(adaptor.target(workspace.config))
      },
    }

    // Cache the handle
    resolveCache.set(cacheKey, { handle, expires: now + CACHE_TTL_MS })
    log.info("resolved sandbox handle", { workspaceID: workspace.id, type: workspace.config.type })

    return handle
  }

  export function invalidateWorkspace(workspaceID: string) {
    resolveCache.delete(`workspace:${workspaceID}`)
  }

  /**
   * Create a new sandbox workspace.
   * Delegates to Workspace.create().
   */
  export async function create(input: {
    projectID: string
    branch?: string | null
    config: Sandbox.ConfigInput
  }): Promise<Sandbox.Handle> {
    const workspace = await Workspace.create({
      projectID: input.projectID,
      branch: input.branch ?? null,
      config: input.config as any,
    })
    log.info("sandbox created", { workspaceID: workspace.id, type: workspace.config.type })
    return resolve({ type: "workspace", workspaceID: workspace.id })
  }

  /**
   * Delete a sandbox workspace.
   * Delegates to Workspace.remove().
   */
  export async function delete_(ref: Sandbox.Ref): Promise<void> {
    if (ref.type === "local") {
      log.warn("delete: local sandbox has no persistent state to delete", { directory: ref.directory })
      return
    }
    log.info("sandbox deleting", { workspaceID: ref.workspaceID })
    invalidateWorkspace(ref.workspaceID)
    await Workspace.remove(ref.workspaceID)
  }

  /**
   * Health check for a sandbox.
   */
  export async function healthCheck(ref: Sandbox.Ref): Promise<boolean> {
    if (ref.type === "local") {
      // Local sandboxes are always healthy (just a directory)
      return true
    }
    const workspace = await Workspace.get(ref.workspaceID)
    if (!workspace) {
      log.warn("healthCheck: workspace not found", { workspaceID: ref.workspaceID })
      return false
    }
    const adaptor = getAdaptor(workspace.config)
    if (!adaptor.healthCheck) return true
    return adaptor.healthCheck(workspace.config as any)
  }

  /**
   * Clear the resolve cache.
   * Useful for testing or when forcing fresh resolution.
   */
  export function clearCache() {
    resolveCache.clear()
  }
}

// Extend Sandbox namespace with ConfigInput for create()
declare module "./types" {
  export namespace Sandbox {
    export type ConfigInput =
      | { type: "worktree"; directory: string; strategy?: "git" | "cow"; eventLimit?: number }
      | {
          type: "container"
          directory: string
          runtime: "docker" | "podman"
          image: string
          containerName: string
          port: number
          serverUrl: string
          eventLimit?: number
        }
  }
}
