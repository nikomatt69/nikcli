import z from "zod"
import { BusEvent } from "@/bus/bus-event"
import { GlobalBus } from "@/bus/global"
import { Identifier } from "@/id/id"
import { PermissionNext } from "@/permission/next"
import { Project } from "@/project/project"
import { InstanceBootstrap } from "@/project/bootstrap"
import { Instance } from "@/project/instance"
import { SessionStatus } from "@/session/status"
import { Storage } from "@/storage/storage"
import { fn } from "@/util/fn"
import { Log } from "@/util/log"
import { getAdaptor } from "./adaptors"
import { Config } from "./config"
import { parseSSE } from "./sse"

export namespace Workspace {
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

  function fromStorage(row: Partial<Info>): Info {
    return Info.parse({
      ...row,
      branch: row.branch ?? null,
    })
  }

  const syncControllers = new Map<string, AbortController>()

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
      await Storage.write(["workspace", info.projectID, info.id], info)
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
    const rows = await Storage.list(["workspace", project.id])
    const result = await Promise.all(rows.map((row) => Storage.read<Info>(row).catch(() => undefined)))
    return result
      .filter((row): row is Info => !!row)
      .map(fromStorage)
      .sort((a, b) => a.id.localeCompare(b.id))
  }

  export const get = fn(Identifier.schema("workspace"), async (id) => {
    const rows = await Storage.list(["workspace"])
    for (const row of rows) {
      const result = await Storage.read<Info>(row).catch(() => undefined)
      if (!result || result.id !== id) continue
      return fromStorage(result)
    }
    return undefined
  })

  export const remove = fn(Identifier.schema("workspace"), async (id) => {
    const info = await get(id)
    if (info) {
      stopSpaceSync(id)
      await getAdaptor(info.config).remove(info.config)
      await Storage.remove(["workspace", info.projectID, id])
      return info
    }
  })
  const log = Log.create({ service: "workspace-sync" })

  async function workspaceEventLoop(space: Info, stop: AbortSignal) {
    const adaptor = getAdaptor(space.config)
    const target = await Promise.resolve(adaptor.target(space.config))

    if (target.type === "local") return

    const baseURL = String(target.url).replace(/\/?$/, "/")

    while (!stop.aborted) {
      const res = await fetch(new URL(baseURL + "event"), {
        method: "GET",
        headers: target.headers,
        signal: stop,
      }).catch(() => undefined)
      if (!res || !res.ok || !res.body) {
        await Bun.sleep(1000)
        continue
      }
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
      await Bun.sleep(250)
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
}
