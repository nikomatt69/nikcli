import z from "zod"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { GlobalBus } from "@/bus/global"
import { Identifier } from "@/id/id"
import { PermissionNext } from "@/permission/next"
import { Project } from "@/project/project"
import { InstanceBootstrap } from "@/project/bootstrap"
import { Instance } from "@/project/instance"
import { SessionStatus } from "@/session/status"
import { fn } from "@/util/fn"
import { Log } from "@/util/log"
import { getAdaptor } from "./adaptors"
import { Config } from "./config"
import { parseSSE } from "./sse"
import { SandboxRegistry } from "@/sandbox/registry"
import { WorkspaceDB } from "./db"

export namespace Workspace {
  export const ConnectionStatus = z.enum(["connecting", "connected", "disconnected", "error"])
  export type ConnectionStatus = z.infer<typeof ConnectionStatus>

  export const Event = {
    Ready: BusEvent.define(
      "workspace.ready",
      z.object({
        name: z.string(),
      }),
    ),
    Failed: BusEvent.define(
      "workspace.failed",
      z.object({
        message: z.string(),
      }),
    ),
    Status: BusEvent.define(
      "workspace.status",
      z.object({
        workspaceID: Identifier.schema("workspace"),
        status: ConnectionStatus,
      }),
    ),
  }

  export const Info = z
    .object({
      id: Identifier.schema("workspace"),
      branch: z.string().nullable(),
      projectID: z.string(),
      config: Config,
    })
    .meta({
      ref: "Workspace",
    })
  export type Info = z.infer<typeof Info>

  export const Restore = z
    .object({
      workspaceID: Identifier.schema("workspace"),
      sessions: z.array(z.string()).default([]),
      events: z.array(z.unknown()).default([]),
    })
    .meta({ ref: "Workspace.Restore" })
  export type Restore = z.infer<typeof Restore>

  function fromRow(row: WorkspaceDB.Info): Info {
    return Info.parse({
      ...row,
      branch: row.branch ?? null,
    })
  }

  const syncControllers = new Map<string, AbortController>()
  const connectionStatuses = new Map<string, ConnectionStatus>()

  export function status(workspaceID: string): ConnectionStatus {
    return connectionStatuses.get(workspaceID) ?? "connected"
  }

  function setStatus(workspaceID: string, next: ConnectionStatus) {
    const prev = connectionStatuses.get(workspaceID)
    if (prev === next) return
    connectionStatuses.set(workspaceID, next)
    void Bus.publish(Event.Status, { workspaceID, status: next }).catch(() => undefined)
  }

  function syncDirectory(space: Info) {
    if (space.config.type === "worktree") return
    return space.config.directory
  }

  async function mirrorWorkspaceEvent(space: Info, event: { type?: string; properties?: any }) {
    const directory = syncDirectory(space)
    if (!directory || !event?.type) return

    await Instance.provide({
      directory,
      init: InstanceBootstrap,
      async fn() {
        if (event.type === "session.status" && event.properties?.sessionID && event.properties?.status) {
          SessionStatus.hydrate(event.properties.sessionID, event.properties.status)
        }

        if (event.type === "session.idle" && event.properties?.sessionID) {
          SessionStatus.hydrate(event.properties.sessionID, { type: "idle" })
        }

        if (event.type === "permission.asked" && event.properties?.id) {
          await PermissionNext.hydrateAsk(event.properties)
        }

        if (event.type === "permission.replied" && event.properties?.requestID) {
          await PermissionNext.hydrateReply(event.properties.requestID)
        }
      },
    })
  }

  function startSpaceSync(space: Info) {
    if (space.config.type === "worktree") return
    if (syncControllers.has(space.id)) return

    const stop = new AbortController()
    syncControllers.set(space.id, stop)

    void workspaceEventLoop(space, stop.signal)
      .catch((error) => {
        log.warn("workspace sync listener failed", {
          workspaceID: space.id,
          error,
        })
      })
      .finally(() => {
        if (syncControllers.get(space.id) === stop) syncControllers.delete(space.id)
      })
  }

  function stopSpaceSync(id: string) {
    const controller = syncControllers.get(id)
    if (!controller) return
    controller.abort()
    syncControllers.delete(id)
  }

  export const create = fn(
    z.object({
      id: Identifier.schema("workspace").optional(),
      projectID: Info.shape.projectID,
      branch: Info.shape.branch,
      config: Info.shape.config,
    }),
    async (input) => {
      const id = Identifier.ascending("workspace", input.id)

      const { config, init } = await getAdaptor(input.config).create(input.config, input.branch, id)

      const info: Info = {
        id,
        projectID: input.projectID,
        branch: input.branch,
        config,
      }

      await init()
      await WorkspaceDB.migrateFromStorage()
      WorkspaceDB.upsert(info)
      startSpaceSync(info)

      GlobalBus.emit("event", {
        directory: id,
        payload: {
          type: Event.Ready.type,
          properties: {},
        },
      })

      return info
    },
  )

  export async function list(project: Project.Info) {
    await WorkspaceDB.migrateFromStorage()
    return WorkspaceDB.list(project.id).map(fromRow)
  }

  export const get = fn(Identifier.schema("workspace"), async (id) => {
    await WorkspaceDB.migrateFromStorage()
    const row = WorkspaceDB.get(id)
    return row ? fromRow(row) : undefined
  })

  export const sandbox = fn(Identifier.schema("workspace"), async (id) => {
    const info = await get(id)
    if (!info) return undefined
    return SandboxRegistry.resolve({
      type: "workspace",
      workspaceID: info.id,
    })
  })

  export const target = fn(Identifier.schema("workspace"), async (id) => {
    const resolved = await sandbox(id)
    if (!resolved) return undefined
    return resolved.target()
  })

  export const remove = fn(Identifier.schema("workspace"), async (id) => {
    const info = await get(id)
    if (info) {
      stopSpaceSync(id)
      await getAdaptor(info.config).remove(info.config)
      WorkspaceDB.remove(id)
      connectionStatuses.delete(id)
      return info
    }
  })
  const log = Log.create({ service: "workspace-sync" })

  async function workspaceEventLoop(space: Info, stop: AbortSignal) {
    const target = await Workspace.target(space.id)

    if (!target || target.type === "local") return

    const baseURL = String(target.url).replace(/\/?$/, "/")
    const BACKOFF_BASE_MS = 1000
    const BACKOFF_CAP_MS = 30_000
    let backoff = BACKOFF_BASE_MS

    try {
      while (!stop.aborted) {
        setStatus(space.id, "connecting")
        const res = await fetch(new URL(baseURL + "event"), {
          method: "GET",
          headers: target.headers,
          signal: stop,
        }).catch(() => undefined)
        if (!res || !res.ok || !res.body) {
          setStatus(space.id, "error")
          await Bun.sleep(backoff)
          backoff = Math.min(backoff * 2, BACKOFF_CAP_MS)
          continue
        }
        backoff = BACKOFF_BASE_MS
        setStatus(space.id, "connected")
        await parseSSE(res.body, stop, (event) => {
          const payload = event as { type?: string; properties?: any }
          void mirrorWorkspaceEvent(space, payload).catch((error) => {
            log.warn("workspace event mirror failed", {
              workspaceID: space.id,
              error,
              type: payload?.type,
            })
          })
          GlobalBus.emit("event", {
            directory: space.id,
            payload,
          })
        })
        if (!stop.aborted) setStatus(space.id, "disconnected")
        await Bun.sleep(250)
      }
    } finally {
      setStatus(space.id, "disconnected")
    }
  }

  export function startSyncing(project: Project.Info) {
    void (async () => {
      const spaces = (await list(project)).filter((space) => space.config.type !== "worktree")
      spaces.forEach(startSpaceSync)
    })()

    return {
      async stop() {
        const spaces = await list(project)
        spaces.forEach((space) => stopSpaceSync(space.id))
      },
    }
  }

  export function stopAllSyncing() {
    for (const id of [...syncControllers.keys()]) {
      stopSpaceSync(id)
    }
  }

  /**
   * Ensures the workspace's event sync loop is running and resolves once the
   * workspace reports `connected` (or rejects on timeout / abort).
   * For local workspaces the promise resolves immediately.
   */
  export const restore = fn(
    z.object({
      workspaceID: Identifier.schema("workspace"),
      timeoutMs: z.number().int().positive().default(30_000),
      signal: z.any().optional(),
    }),
    async ({ workspaceID, timeoutMs, signal }) => {
      const info = await get(workspaceID)
      if (!info) throw new Error(`Workspace not found: ${workspaceID}`)
      if (info.config.type === "worktree") {
        setStatus(workspaceID, "connected")
        return info
      }
      startSpaceSync(info)
      if (status(workspaceID) === "connected") return info
      const { EventLoop } = await import("@/util/eventloop")
      await EventLoop.waitEvent({
        event: Event.Status,
        timeoutMs,
        signal: signal as AbortSignal | undefined,
        predicate: (p) => p.workspaceID === workspaceID && p.status === "connected",
      })
      return info
    },
  )
}
