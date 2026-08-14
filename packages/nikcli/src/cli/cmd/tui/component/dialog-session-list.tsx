import { useDialog } from "@tui/ui/dialog"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useRoute } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { createMemo, createSignal, createResource, onMount } from "solid-js"
import { Locale } from "@/util/locale"
import { useKeybind } from "../context/keybind"
import { useTheme } from "../context/theme"
import { useLocal } from "../context/local"
import { useSDK } from "../context/sdk"
import { DialogSessionRename } from "./dialog-session-rename"
import { createDebouncedSignal } from "../util/signal"
import { createNikcliClient } from "@nikcli-ai/sdk/httpapi"
import { useToast } from "../ui/toast"
import { Keybind } from "@/util/keybind"
import { Spinner } from "./spinner"
import { abbreviateHome } from "../util/path-format"
import path from "path"
import { DialogWorkspaceCreate, openWorkspace } from "./dialog-workspace-list"
import { DialogWorkspaceScope, workspaceScopeDirectory } from "./dialog-workspace-create"
type WorkspaceStatus = "connected" | "connecting" | "disconnected" | "error"

/**
 * "project" lists what the instance's own project owns; "global" lists the
 * global project — the sessions started outside any repo, which a project-bound
 * TUI would otherwise have no way to reach. The switch is a view: sessions open
 * by id regardless of which project stores them.
 */
type Scope = "project" | "global"

export function DialogSessionList(
  props: {
    workspaceID?: string
    localOnly?: boolean
    /** Instance that owns `workspaceID`; defaults to the current directory. */
    directory?: string
  } = {},
) {
  const dialog = useDialog()
  const route = useRoute()
  const sync = useSync()
  const keybind = useKeybind()
  const { theme } = useTheme()
  const local = useLocal()
  const sdk = useSDK()
  const toast = useToast()

  const [toDelete, setToDelete] = createSignal<string>()
  const [search, setSearch] = createDebouncedSignal("", 150)
  const [scope, setScope] = createSignal<Scope>("project")

  // A workspace or local-only list is already scoped by its own rule; the
  // project/global switch only makes sense for the plain session list.
  const scopeSwitchable = createMemo(() => !props.workspaceID && !props.localOnly)
  const globalScope = createMemo(() => scopeSwitchable() && scope() === "global")

  /**
   * The filesystem root has no `.git` above it, so the server resolves it to
   * the global project — the same project a `nikcli` started outside a repo
   * binds to.
   */
  const globalDirectory = createMemo(() => path.parse(sync.data.path.directory || sdk.directory || ".").root || "/")

  /**
   * `keybind.all` is typed from the generated `KeybindsConfig`, which only
   * catches up with the config schema when the SDK is rebuilt — so read the
   * configured binding off the raw config and fall back to the schema default.
   */
  const scopeKeybind = createMemo(() => {
    const keybinds = sync.data.config.keybinds as Record<string, string | undefined> | undefined
    return Keybind.parse(keybinds?.["session_scope_toggle"] || "ctrl+g")[0]
  })

  const ownerDirectory = () => props.directory || sync.data.path.directory || sdk.directory

  const workspaceClient = () => {
    if (!props.workspaceID) return sdk.client
    return createNikcliClient({
      baseUrl: sdk.url,
      fetch: sdk.fetch,
      directory: ownerDirectory(),
      workspace: props.workspaceID,
    })
  }

  const globalClient = createMemo(() =>
    createNikcliClient({
      baseUrl: sdk.url,
      fetch: sdk.fetch,
      directory: globalDirectory(),
    }),
  )

  /** The client that owns the sessions currently on screen. */
  const scopeClient = () => (globalScope() ? globalClient() : workspaceClient())

  async function restoreWorkspace(workspaceID: string) {
    const restored = await createNikcliClient({ baseUrl: sdk.url, fetch: sdk.fetch, directory: ownerDirectory() })
      .experimental.workspace.restore({ id: workspaceID })
      .catch(() => undefined)
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

  const [globalSessions, { mutate: mutateGlobal }] = createResource(
    () => (globalScope() ? globalDirectory() : undefined),
    async () => {
      const result = await globalClient()
        .session.list({ roots: true })
        .catch(() => undefined)
      if (!result) {
        toast.show({ message: "Failed to load global sessions", variant: "error" })
        return []
      }
      return result.data ?? []
    },
  )

  const [searchResults] = createResource(
    () => ({ query: search(), global: globalScope() }),
    async (input) => {
      if (!input.query || props.localOnly) return undefined
      if (props.workspaceID) {
        const ready = await restoreWorkspace(props.workspaceID)
        if (!ready) return []
      }
      const result = await scopeClient().session.list({
        search: input.query,
        limit: 30,
        ...(props.workspaceID || input.global ? { roots: true } : {}),
      })
      return result.data ?? []
    },
  )

  const currentSessionID = createMemo(() => (route.data.type === "session" ? route.data.sessionID : undefined))

  const sessions = createMemo(() => {
    if (searchResults()) return searchResults()!
    if (props.workspaceID) return listed() ?? []
    if (globalScope()) return globalSessions() ?? []
    if (props.localOnly) return sync.data.session.filter((session) => !session.workspaceID)
    return sync.data.session
  })

  function createWorkspaceDialog() {
    const directory = sync.data.path.directory || sdk.directory || process.cwd()
    dialog.replace(() => (
      <DialogWorkspaceScope
        currentDirectory={directory}
        current={globalScope() ? "global" : "project"}
        onSelect={(scope) =>
          dialog.replace(() => (
            <DialogWorkspaceCreate
              scope={scope}
              onSelect={(workspaceID) =>
                openWorkspace({
                  dialog,
                  route,
                  sdk,
                  sync,
                  toast,
                  workspaceID,
                  directory: workspaceScopeDirectory(directory, scope),
                })
              }
            />
          ))
        }
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
        if (globalScope()) return true
        if (props.localOnly) return !x.workspaceID
        return true
      })
      .toSorted((a, b) => {
        // Pinned sessions float to the top, then most-recently-updated first.
        const pinDelta = (local.session.isPinned(b.id) ? 1 : 0) - (local.session.isPinned(a.id) ? 1 : 0)
        if (pinDelta !== 0) return pinDelta
        return b.time.updated - a.time.updated
      })
      .map((x) => {
        const date = new Date(x.time.updated)
        const pinned = local.session.isPinned(x.id)
        let category = date.toDateString()
        if (category === today) {
          category = "Today"
        }
        if (pinned) category = "Pinned"
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
            ? `${workspace.config.type}: ${workspace.name || workspace.id}`
            : "unknown workspace"
          : globalScope()
            ? // Global sessions come from anywhere on disk, so the time alone
              // does not say which one you are about to open.
              `${Locale.time(x.time.updated)} · ${abbreviateHome(x.directory, sync.data.path.home)}`
            : Locale.time(x.time.updated)

        const gutter = isWorking ? (
          <Spinner />
        ) : workspaceStatus ? (
          <text fg={workspaceStatus === "connected" ? theme.status.success.fg : theme.foreground.muted}>■</text>
        ) : pinned ? (
          <text fg={theme.status.warning.fg}>★</text>
        ) : undefined

        return {
          title: isDeleting ? `Press ${keybind.print("session_delete")} again to confirm` : x.title,
          bg: isDeleting ? theme.status.error.fg : undefined,
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
      title={
        props.workspaceID
          ? "Workspace Sessions"
          : props.localOnly
            ? "Local Sessions"
            : globalScope()
              ? "Sessions · Global"
              : "Sessions · Project"
      }
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
              const deleted = await scopeClient()
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
              if (globalScope()) {
                mutateGlobal((sessions) => sessions?.filter((session) => session.id !== option.value))
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
          keybind: keybind.all.session_pin_toggle?.[0],
          title: "pin/unpin",
          onTrigger: (option) => {
            const wasPinned = local.session.isPinned(option.value)
            local.session.togglePin(option.value)
            toast.show({
              message: wasPinned ? "Session unpinned" : "Session pinned",
              variant: "info",
              duration: 2000,
            })
          },
        },
        {
          keybind: scopeKeybind(),
          title: globalScope() ? "project scope" : "global scope",
          disabled: !scopeSwitchable(),
          // Fires with nothing selected on purpose: a scope with zero sessions
          // must still be switchable back.
          allowEmpty: true,
          onTrigger: () => {
            setToDelete(undefined)
            setScope((current) => (current === "global" ? "project" : "global"))
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
