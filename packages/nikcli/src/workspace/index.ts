import z from "zod"
import { BusEvent } from "@/bus/bus-event"
import { GlobalBus } from "@/bus/global"
import { Identifier } from "@/id/id"
import { Project } from "@/project/project"
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

  export const create = fn(
    z.object({
      id: Identifier.schema("workspace").optional(),
      projectID: Info.shape.projectID,
      branch: Info.shape.branch,
      config: Info.shape.config,
    }),
    async (input) => {
      const id = Identifier.ascending("workspace", input.id)

      const { config, init } = await getAdaptor(input.config).create(input.config, input.branch)

      const info: Info = {
        id,
        projectID: input.projectID,
        branch: input.branch,
        config,
      }

      setTimeout(async () => {
        await init()

        await Storage.write(["workspace", info.projectID, info.id], info)

        GlobalBus.emit("event", {
          directory: id,
          payload: {
            type: Event.Ready.type,
            properties: {},
          },
        })
      }, 0)

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
      await getAdaptor(info.config).remove(info.config)
      await Storage.remove(["workspace", info.projectID, id])
      return info
    }
  })
  const log = Log.create({ service: "workspace-sync" })

  async function workspaceEventLoop(space: Info, stop: AbortSignal) {
    while (!stop.aborted) {
      const res = await getAdaptor(space.config)
        .request(space.config, "GET", "/event", undefined, stop)
        .catch(() => undefined)
      if (!res || !res.ok || !res.body) {
        await Bun.sleep(1000)
        continue
      }
      await parseSSE(res.body, stop, (event) => {
        GlobalBus.emit("event", {
          directory: space.id,
          payload: event,
        })
      })
      await Bun.sleep(250)
    }
  }

  export function startSyncing(project: Project.Info) {
    const stop = new AbortController()

    void (async () => {
      const spaces = (await list(project)).filter((space) => space.config.type !== "worktree")

      spaces.forEach((space) => {
        void workspaceEventLoop(space, stop.signal).catch((error) => {
          log.warn("workspace sync listener failed", {
            workspaceID: space.id,
            error,
          })
        })
      })
    })()

    return {
      async stop() {
        stop.abort()
      },
    }
  }
}
