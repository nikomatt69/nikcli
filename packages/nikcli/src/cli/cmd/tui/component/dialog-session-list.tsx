import { useDialog } from "@tui/ui/dialog"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useRoute } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { createMemo, createSignal, createResource, onMount } from "solid-js"
import { Locale } from "@/util/locale"
import { useKeybind } from "../context/keybind"
import { useTheme } from "../context/theme"
import { useSDK } from "../context/sdk"
import { DialogSessionRename } from "./dialog-session-rename"
import { createDebouncedSignal } from "../util/signal"
import { createNikcliClient } from "@nikcli-ai/sdk/v2"
import { useToast } from "../ui/toast"
import { Keybind } from "@/util/keybind"
import { Spinner } from "./spinner"
import { DialogWorkspaceCreate, openWorkspace } from "./dialog-workspace-list"
type WorkspaceStatus = "connected" | "connecting" | "disconnected" | "error"

export function DialogSessionList(props: { workspaceID?: string; localOnly?: boolean } = {}) {
  const dialog = useDialog()
  const route = useRoute()
  const sync = useSync()
  const keybind = useKeybind()
  const { theme } = useTheme()
  const sdk = useSDK()
  const toast = useToast()

  const [toDelete, setToDelete] = createSignal<string>()
  const [search, setSearch] = createDebouncedSignal("", 150)

  const workspaceClient = () => {
    if (!props.workspaceID) return sdk.client
    return createNikcliClient({
      baseUrl: sdk.url,
      fetch: sdk.fetch,
      directory: sync.data.path.directory || sdk.directory,
      workspace: props.workspaceID,
    })
  }

  async function restoreWorkspace(workspaceID: string) {
    const restored = await sdk.client.experimental.workspace.restore({ id: workspaceID }).catch(() => undefined)
    if (restored?.data) return true
    toast.show({
      message: "Failed to connect workspace",
      variant: "error",
    })
    return false
  }

  const [listed, { mutate: mutateListed }] = createResource(
    () => props.workspaceID,
    async (workspaceID) => {
      if (!workspaceID) return undefined
      const ready = await restoreWorkspace(workspaceID)
      if (!ready) return []
      const result = await workspaceClient().session.list({ roots: true })
      return result.data ?? []
    },
  )

  const [searchResults] = createResource(search, async (query) => {
    if (!query || props.localOnly) return undefined
    if (props.workspaceID) {
      const ready = await restoreWorkspace(props.workspaceID)
      if (!ready) return []
    }
    const result = await workspaceClient().session.list({
      search: query,
      limit: 30,
      ...(props.workspaceID ? { roots: true } : {}),
    })
    return result.data ?? []
  })

  const currentSessionID = createMemo(() => (route.data.type === "session" ? route.data.sessionID : undefined))

  const sessions = createMemo(() => {
    if (searchResults()) return searchResults()!
    if (props.workspaceID) return listed() ?? []
    if (props.localOnly) return sync.data.session.filter((session) => !session.workspaceID)
    return sync.data.session
  })

  function createWorkspaceDialog() {
    dialog.replace(() => (
      <DialogWorkspaceCreate
        onSelect={(workspaceID) => openWorkspace({ dialog, route, sdk, sync, toast, workspaceID })}
      />
    ))
  }

  const options = createMemo(() => {
    const today = new Date().toDateString()
    return sessions()
      .filter((x) => {
        if (x.parentID !== undefined) return false
        if (props.workspaceID && listed()) return true
        if (props.workspaceID) return x.workspaceID === props.workspaceID
        if (props.localOnly) return !x.workspaceID
        return true
      })
      .toSorted((a, b) => b.time.updated - a.time.updated)
      .map((x) => {
        const date = new Date(x.time.updated)
        let category = date.toDateString()
        if (category === today) {
          category = "Today"
        }
        const isDeleting = toDelete() === x.id
        const status = sync.data.session_status?.[x.id]
        const isWorking = status?.type === "busy"

        const workspace = x.workspaceID ? sync.workspace.get(x.workspaceID) : undefined
        let workspaceStatus: WorkspaceStatus | null = null
        if (x.workspaceID) {
          workspaceStatus = workspace ? "connected" : "disconnected"
        }

        const footer = x.workspaceID
          ? workspace
            ? `${workspace.config.type}: ${workspace.id}`
            : "unknown workspace"
          : Locale.time(x.time.updated)

        const gutter = isWorking ? (
          <Spinner />
        ) : workspaceStatus ? (
          <text fg={workspaceStatus === "connected" ? theme.success : theme.textMuted}>■</text>
        ) : undefined

        return {
          title: isDeleting ? `Press ${keybind.print("session_delete")} again to confirm` : x.title,
          bg: isDeleting ? theme.error : undefined,
          value: x.id,
          category,
          footer,
          gutter,
        }
      })
  })

  onMount(() => {
    dialog.setSize("large")
  })

  return (
    <DialogSelect
      title={props.workspaceID ? "Workspace Sessions" : props.localOnly ? "Local Sessions" : "Sessions"}
      options={options()}
      skipFilter={!!props.localOnly}
      current={currentSessionID()}
      onFilter={setSearch}
      onMove={() => {
        setToDelete(undefined)
      }}
      onSelect={(option) => {
        route.navigate({
          type: "session",
          sessionID: option.value,
          workspaceID: props.workspaceID ?? sync.session.get(option.value)?.workspaceID,
        })
        dialog.clear()
      }}
      keybind={[
        {
          keybind: keybind.all.session_delete?.[0],
          title: "delete",
          onTrigger: async (option) => {
            if (toDelete() === option.value) {
              const deleted = await workspaceClient()
                .session.delete({
                  sessionID: option.value,
                })
                .then(() => true)
                .catch(() => false)
              setToDelete(undefined)
              if (!deleted) {
                toast.show({
                  message: "Failed to delete session",
                  variant: "error",
                })
                return
              }
              if (props.workspaceID) {
                mutateListed((sessions) => sessions?.filter((session) => session.id !== option.value))
                return
              }
              sync.set(
                "session",
                sync.data.session.filter((session) => session.id !== option.value),
              )
              return
            }
            setToDelete(option.value)
          },
        },
        {
          keybind: keybind.all.session_rename?.[0],
          title: "rename",
          onTrigger: async (option) => {
            dialog.replace(() => <DialogSessionRename session={option.value} workspaceID={props.workspaceID} />)
          },
        },
        {
          keybind: Keybind.parse("ctrl+w")[0],
          title: "new workspace",
          onTrigger: () => {
            createWorkspaceDialog()
          },
        },
      ]}
    />
  )
}
