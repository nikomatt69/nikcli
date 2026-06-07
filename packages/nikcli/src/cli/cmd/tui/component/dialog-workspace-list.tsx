import { useDialog } from "@tui/ui/dialog"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useRoute } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { createEffect, createMemo, createSignal, onMount } from "solid-js"
import type { Session } from "@nikcli-ai/sdk/v2"
import { createNikcliClient } from "@nikcli-ai/sdk/v2"
import { useSDK } from "../context/sdk"
import { useToast } from "../ui/toast"
import { useKeybind } from "../context/keybind"
import { DialogSessionList } from "./dialog-session-list"
import { useTheme } from "../context/theme"
import { DialogWorkspaceCreate } from "./dialog-workspace-create"
import { useProject } from "../context/project"

export { DialogWorkspaceCreate } from "./dialog-workspace-create"

export async function openWorkspace(input: {
  dialog: ReturnType<typeof useDialog>
  route: ReturnType<typeof useRoute>
  sdk: ReturnType<typeof useSDK>
  sync: ReturnType<typeof useSync>
  toast: ReturnType<typeof useToast>
  workspaceID: string
  forceCreate?: boolean
}) {
  const cacheSession = (session: Session) => {
    input.sync.set(
      "session",
      [...input.sync.data.session.filter((item) => item.id !== session.id), session].toSorted((a, b) =>
        a.id.localeCompare(b.id),
      ),
    )
  }

  function scoped(workspaceID?: string) {
    return createNikcliClient({
      baseUrl: input.sdk.url,
      fetch: input.sdk.fetch,
      directory: input.sync.data.path.directory || input.sdk.directory,
      workspace: workspaceID,
    })
  }
  const client = scoped(input.workspaceID)
  const restored = await input.sdk.client.experimental.workspace
    .restore({ id: input.workspaceID })
    .catch(() => undefined)
  if (!restored?.data) {
    input.toast.show({
      message: "Failed to connect workspace",
      variant: "error",
    })
    return
  }

  const sessionID = input.forceCreate ? undefined : restored.data.sessions?.[0]
  if (sessionID) {
    const session = await input.sync.session.sync(sessionID, { full: true }).catch(() => undefined)
    if (session) cacheSession(session)
    input.route.navigate({
      type: "session",
      sessionID,
      workspaceID: session?.workspaceID ?? input.workspaceID,
    })
    input.dialog.clear()
    return
  }

  let created: Session | undefined
  while (!created) {
    const result = await client.session.create({ workspaceID: input.workspaceID }).catch(() => undefined)
    if (!result) {
      input.toast.show({
        message: "Failed to open workspace",
        variant: "error",
      })
      return
    }
    if (result.response.status >= 500 && result.response.status < 600) {
      await Bun.sleep(1000)
      continue
    }
    if (!result.data) {
      input.toast.show({
        message: "Failed to open workspace",
        variant: "error",
      })
      return
    }
    created = result.data
  }

  cacheSession(created)
  input.route.navigate({
    type: "session",
    sessionID: created.id,
    workspaceID: created.workspaceID ?? input.workspaceID,
  })
  input.dialog.clear()
}

export function DialogWorkspaceList() {
  const dialog = useDialog()
  const route = useRoute()
  const sync = useSync()
  const sdk = useSDK()
  const toast = useToast()
  const keybind = useKeybind()
  const { theme } = useTheme()
  const project = useProject()

  function scoped(workspaceID?: string) {
    return createNikcliClient({
      baseUrl: sdk.url,
      fetch: sdk.fetch,
      directory: sync.data.path.directory || sdk.directory,
      workspace: workspaceID,
    })
  }
  const [toDelete, setToDelete] = createSignal<string>()
  const [removing, setRemoving] = createSignal<string>()
  const [counts, setCounts] = createSignal<Record<string, number | null | undefined>>({})

  async function syncWorkspaces() {
    await sdk.client.experimental.workspace.syncList().catch(() => undefined)
    await Promise.all([sync.workspace.sync(), project.workspace.sync()])
  }

  const open = (workspaceID: string, forceCreate?: boolean) =>
    openWorkspace({
      dialog,
      route,
      sdk,
      sync,
      toast,
      workspaceID,
      forceCreate,
    })

  async function selectWorkspace(workspaceID: string) {
    if (workspaceID === "__local__") {
      if (localCount() > 0) {
        dialog.replace(() => <DialogSessionList localOnly={true} />)
        return
      }
      route.navigate({
        type: "home",
      })
      dialog.clear()
      return
    }

    const count = counts()[workspaceID]
    if (count && count > 0) {
      dialog.replace(() => <DialogSessionList workspaceID={workspaceID} />)
      return
    }

    if (count === 0) {
      await open(workspaceID)
      return
    }

    const client = scoped(workspaceID)
    const listed = await client.session.list({ roots: true, limit: 1 }).catch(() => undefined)
    if (listed?.data?.length) {
      dialog.replace(() => <DialogSessionList workspaceID={workspaceID} />)
      return
    }
    await open(workspaceID)
  }

  const currentWorkspaceID = createMemo(() => {
    if (route.data.type === "session") {
      return route.data.workspaceID ?? sync.session.get(route.data.sessionID)?.workspaceID ?? "__local__"
    }
    return route.data.workspaceID ?? "__local__"
  })

  const localCount = createMemo(
    () => sync.data.session.filter((session) => !session.workspaceID && !session.parentID).length,
  )

  let run = 0
  createEffect(() => {
    const workspaces = sync.data.workspaceList
    const next = ++run
    if (!workspaces.length) {
      setCounts({})
      return
    }

    setCounts(Object.fromEntries(workspaces.map((workspace) => [workspace.id, undefined])))
    void Promise.all(
      workspaces.map(async (workspace) => {
        const client = createNikcliClient({
          baseUrl: sdk.url,
          fetch: sdk.fetch,
          directory: sync.data.path.directory || sdk.directory,
          workspace: workspace.id,
        })
        const result = await client.session.list({ roots: true }).catch(() => undefined)
        return [workspace.id, result ? (result.data?.length ?? 0) : null] as const
      }),
    ).then((entries) => {
      if (run !== next) return
      setCounts(Object.fromEntries(entries))
    })
  })

  const options = createMemo(() => [
    {
      title: "Local",
      value: "__local__",
      category: "Workspace",
      description: "Use the local machine",
      footer: `${localCount()} session${localCount() === 1 ? "" : "s"}`,
    },
    ...sync.data.workspaceList
      .toSorted((a, b) => (a.name || a.id).localeCompare(b.name || b.id))
      .map((workspace) => {
        const count = counts()[workspace.id]
        const label = workspace.name || workspace.id
        const status = project.workspace.status(workspace.id)
        return {
          title:
            removing() === workspace.id
              ? "Deleting..."
              : toDelete() === workspace.id
                ? `Delete ${label}? Press ${keybind.print("session_delete")} again`
                : label,
          value: workspace.id,
          category: workspace.config.type,
          description: workspace.branch ? `Branch ${workspace.branch}` : undefined,
          gutter: (
            <text fg={status === "connected" ? theme.success : status === "error" ? theme.error : theme.textMuted}>
              ●
            </text>
          ),
          footer:
            count === undefined
              ? "Loading sessions..."
              : count === null
                ? "Sessions unavailable"
                : `${count} session${count === 1 ? "" : "s"}`,
        }
      }),
    {
      title: "+ New workspace",
      value: "__create__",
      category: "Actions",
      description: "Create a new workspace",
    },
  ])

  onMount(() => {
    dialog.setSize("large")
    void syncWorkspaces()
  })

  return (
    <DialogSelect
      title="Workspaces"
      skipFilter={true}
      options={options()}
      current={currentWorkspaceID()}
      onMove={() => {
        setToDelete(undefined)
      }}
      onSelect={(option) => {
        setToDelete(undefined)
        if (option.value === "__create__") {
          dialog.replace(() => <DialogWorkspaceCreate onSelect={(workspaceID) => open(workspaceID, true)} />)
          return
        }
        void selectWorkspace(option.value)
      }}
      keybind={[
        {
          keybind: keybind.all.session_delete?.[0],
          title: "delete",
          onTrigger: async (option) => {
            if (option.value === "__create__" || option.value === "__local__") return
            if (removing()) return
            if (toDelete() !== option.value) {
              setToDelete(option.value)
              return
            }
            setRemoving(option.value)
            const result = await sdk.client.experimental.workspace.remove({ id: option.value }).catch(() => undefined)
            setToDelete(undefined)
            if (result?.error) {
              setRemoving(undefined)
              toast.show({
                message: "Failed to delete workspace",
                variant: "error",
              })
              return
            }
            if (currentWorkspaceID() === option.value) {
              route.navigate({
                type: "home",
              })
            }
            await syncWorkspaces()
            await sync.bootstrap().catch(() => undefined)
            setRemoving(undefined)
          },
        },
      ]}
    />
  )
}
