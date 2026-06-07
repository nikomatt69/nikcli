import { batch, onCleanup, onMount } from "solid-js"
import type { Path, Workspace } from "@nikcli-ai/sdk/v2"
import { createStore, reconcile } from "solid-js/store"
import { createSimpleContext } from "./helper"
import { useSDK } from "./sdk"
import { Log } from "@/util/log"

const log = Log.create({ service: "project-context" })

export type WorkspaceStatus = "connected" | "connecting" | "disconnected" | "error"

export const { use: useProject, provider: ProjectProvider } = createSimpleContext({
  name: "Project",
  init: () => {
    const sdk = useSDK()

    const defaultPath = {
      state: "",
      config: "",
      worktree: "",
      directory: sdk.directory ?? "",
      home: "",
    } as Path

    const [store, setStore] = createStore({
      project: {
        id: undefined as string | undefined,
      },
      instance: {
        path: defaultPath,
      },
      workspace: {
        current: undefined as string | undefined,
        list: [] as Workspace[],
        status: {} as Record<string, WorkspaceStatus>,
      },
    })

    async function sync() {
      const pathResult = await sdk.client.path.get().catch((err) => {
        log.warn("path sync failed", { error: err })
        return undefined
      })
      batch(() => {
        setStore("instance", "path", reconcile(pathResult?.data || defaultPath))
      })
    }

    async function syncWorkspace() {
      const [listed, statuses] = await Promise.all([
        sdk.client.experimental.workspace.list().catch((err) => {
          log.warn("workspace list sync failed", { error: err })
          return undefined
        }),
        sdk.client.experimental.workspace.status().catch((err) => {
          log.warn("workspace status sync failed", { error: err })
          return undefined
        }),
      ])
      const list = listed?.data ?? []
      const status = Object.fromEntries((statuses?.data ?? []).map((item) => [item.workspaceID, item.status]))
      batch(() => {
        setStore("workspace", "list", reconcile(list))
        setStore("workspace", "status", reconcile(status))
        if (!list.some((item) => item.id === store.workspace.current)) setStore("workspace", "current", undefined)
      })
    }

    function setCurrentWorkspace(id: string | undefined) {
      setStore("workspace", "current", id)
    }

    function setWorkspaceStatus(id: string, status: WorkspaceStatus) {
      setStore("workspace", "status", id, status)
    }

    onMount(() => {
      void sync()
      void syncWorkspace()
    })

    const off = sdk.event.on("server.instance.disposed", () => {
      void sync()
      void syncWorkspace()
    })
    onCleanup(off)
    const offWorkspaceStatus = sdk.event.on("workspace.status", (event) => {
      setWorkspaceStatus(event.properties.workspaceID, event.properties.status)
    })
    onCleanup(offWorkspaceStatus)

    return {
      project: {
        id: () => store.project.id,
      },
      instance: {
        path: () => store.instance.path,
        directory: () => store.instance.path.directory,
      },
      workspace: {
        current: () => store.workspace.current,
        list: () => store.workspace.list,
        status: (id: string) => store.workspace.status[id],
        statuses: () => store.workspace.status,
        set: setCurrentWorkspace,
        setStatus: setWorkspaceStatus,
        sync: syncWorkspace,
      },
      sync,
    }
  },
})
