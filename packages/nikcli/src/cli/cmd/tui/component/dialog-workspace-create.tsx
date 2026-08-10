import { createNikcliClient } from "@nikcli-ai/sdk/v2"
import { useDialog } from "@tui/ui/dialog"
import { DialogSelect } from "@tui/ui/dialog-select"
import { DialogPrompt } from "@tui/ui/dialog-prompt"
import { useRoute } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { useProject } from "@tui/context/project"
import { createMemo, createSignal, onMount } from "solid-js"
import { setTimeout as sleep } from "node:timers/promises"
import { errorData, errorMessage } from "@/util/error"
import { Log } from "@/util/log"
import { Identifier } from "@/id/id"
import path from "node:path"
import { useSDK } from "../context/sdk"
import { useToast } from "../ui/toast"

type Adaptor = {
  type: string
  name: string
  description: string
}

/**
 * Which project owns the environment. The server takes the owner from the
 * instance the request is bound to, so "global" simply means creating through
 * the filesystem root — no `.git` above it, so it resolves to the global
 * project. The environment itself is still built from the current directory;
 * only its ownership (and therefore where it is listed) changes.
 */
export type WorkspaceScope = "project" | "global"

export function workspaceScopeDirectory(directory: string, scope: WorkspaceScope) {
  if (scope === "project") return directory
  return path.parse(directory || ".").root || "/"
}

// Fallback shown only when the adaptor list cannot be fetched; keep the wording
// in sync with the server's `WorktreeAdaptor`.
const DEFAULT_ADAPTORS: Adaptor[] = [
  {
    type: "worktree",
    name: "Project copy",
    description: "Create a local git worktree",
  },
]

const log = Log.create({ service: "tui-workspace" })

function scoped(sdk: ReturnType<typeof useSDK>, sync: ReturnType<typeof useSync>, workspaceID: string) {
  return createNikcliClient({
    baseUrl: sdk.url,
    fetch: sdk.fetch,
    directory: sync.data.path.directory || sdk.directory,
    workspace: workspaceID,
  })
}

export async function openWorkspaceSession(input: {
  dialog: ReturnType<typeof useDialog>
  route: ReturnType<typeof useRoute>
  sdk: ReturnType<typeof useSDK>
  sync: ReturnType<typeof useSync>
  toast: ReturnType<typeof useToast>
  workspaceID: string
}) {
  const client = scoped(input.sdk, input.sync, input.workspaceID)
  log.info("workspace session create requested", {
    workspaceID: input.workspaceID,
  })

  while (true) {
    const result = await client.session.create({ workspaceID: input.workspaceID }).catch((err) => {
      log.error("workspace session create request failed", {
        workspaceID: input.workspaceID,
        error: errorData(err),
      })
      return undefined
    })
    if (!result) {
      input.toast.show({
        message: "Failed to create workspace session",
        variant: "error",
      })
      return
    }
    if (result.response?.status && result.response.status >= 500 && result.response.status < 600) {
      log.warn("workspace session create retrying after server error", {
        workspaceID: input.workspaceID,
        status: result.response.status,
      })
      await sleep(1000)
      continue
    }
    if (!result.data) {
      log.error("workspace session create returned no data", {
        workspaceID: input.workspaceID,
        status: result.response?.status,
      })
      input.toast.show({
        message: "Failed to create workspace session",
        variant: "error",
      })
      return
    }

    await input.sync.session.sync(result.data.id, { full: true }).catch(() => undefined)
    input.route.navigate({
      type: "session",
      sessionID: result.data.id,
      workspaceID: input.workspaceID,
    })
    input.dialog.clear()
    return
  }
}

export async function restoreWorkspaceSession(input: {
  dialog: ReturnType<typeof useDialog>
  sdk: ReturnType<typeof useSDK>
  sync: ReturnType<typeof useSync>
  project: ReturnType<typeof useProject>
  toast: ReturnType<typeof useToast>
  workspaceID: string
  sessionID: string
  done?: () => void
}) {
  log.info("session restore requested", {
    workspaceID: input.workspaceID,
    sessionID: input.sessionID,
  })
  const result = await input.sdk.client.experimental.workspace.session
    .restore({ id: input.workspaceID, sessionID: input.sessionID })
    .catch((err: unknown) => {
      log.error("session restore request failed", {
        workspaceID: input.workspaceID,
        sessionID: input.sessionID,
        error: errorData(err),
      })
      return undefined
    })
  if (!result?.data) {
    input.toast.show({
      message: `Failed to restore session: ${errorMessage(result?.error ?? "no response")}`,
      variant: "error",
    })
    return
  }

  input.project.workspace.set(input.workspaceID)

  try {
    await input.sync.bootstrap()
  } catch {}

  await Promise.all([input.project.workspace.sync(), input.sync.session.sync(input.sessionID, { full: true })]).catch(
    (err) => {
      log.error("session restore refresh failed", {
        workspaceID: input.workspaceID,
        sessionID: input.sessionID,
        error: errorData(err),
      })
      throw err
    },
  )

  input.toast.show({
    message: "Session restored into the new workspace",
    variant: "success",
  })
  input.done?.()
  if (input.done) return
  input.dialog.clear()
}

export function DialogWorkspaceScope(props: {
  currentDirectory: string
  current?: WorkspaceScope
  onSelect: (scope: WorkspaceScope) => void
}) {
  const dialog = useDialog()

  onMount(() => {
    dialog.setSize("medium")
  })

  return (
    <DialogSelect
      title="New Environment · Scope"
      skipFilter={true}
      current={props.current}
      options={[
        {
          title: "Project",
          value: "project" as const,
          description: props.currentDirectory || "The current project",
        },
        {
          title: "Global",
          value: "global" as const,
          description: "Not tied to this project — listed from any directory",
        },
      ]}
      onSelect={(option) => props.onSelect(option.value)}
    />
  )
}

export function DialogWorkspaceCreate(props: {
  onSelect: (workspaceID: string) => Promise<void> | void
  scope?: WorkspaceScope
}) {
  const dialog = useDialog()
  const sync = useSync()
  const project = useProject()
  const sdk = useSDK()
  const toast = useToast()
  const [creating, setCreating] = createSignal<string>()
  const [adaptors, setAdaptors] = createSignal<Adaptor[]>()

  const currentDirectory = () => sync.data.path.directory || sdk.directory || process.cwd()
  const scope = () => props.scope ?? "project"
  const ownerDirectory = () => workspaceScopeDirectory(currentDirectory(), scope())

  onMount(() => {
    dialog.setSize("medium")
    void (async () => {
      const dir = ownerDirectory()
      const url = new URL("/experimental/workspace/adaptor", sdk.url)
      if (dir) url.searchParams.set("directory", dir)
      const res = await sdk
        .fetch(url)
        .then((x) => (x.ok ? (x.json() as Promise<Adaptor[]>) : Promise.reject(new Error(`HTTP ${x.status}`))))
        .catch(() => undefined)
      setAdaptors(res && res.length > 0 ? res : DEFAULT_ADAPTORS)
    })()
  })

  const adaptorName = (type: string) => adaptors()?.find((item) => item.type === type)?.name ?? type

  const options = createMemo(() => {
    const type = creating()
    if (type) {
      return [
        {
          title: `Creating ${adaptorName(type)}...`,
          value: "creating" as const,
          description:
            type === "worktree"
              ? "Adding the git worktree and linking node_modules"
              : "This can take a while for remote environments",
        },
      ]
    }
    const list = adaptors()
    if (!list) {
      return [
        {
          title: "Loading environments...",
          value: "loading" as const,
          description: "Fetching available adaptors",
        },
      ]
    }
    return list.map((item) => ({
      title: item.name,
      value: item.type,
      description: item.description,
    }))
  })

  const create = async (type: string, name?: string) => {
    if (creating()) return
    setCreating(type)
    log.info("workspace create requested", { type })

    const id = Identifier.ascending("workspace")
    // The owner comes from the instance this request is bound to; the
    // environment is still built from the current directory either way.
    const client =
      scope() === "project"
        ? sdk.client
        : createNikcliClient({ baseUrl: sdk.url, fetch: sdk.fetch, directory: ownerDirectory() })
    const result = await client.experimental.workspace
      .create({
        id,
        branch: null,
        config: {
          type,
          directory: currentDirectory(),
          ...(type === "worktree" && name ? { name } : {}),
        } as any,
      })
      .catch((err) => {
        toast.show({
          message: "Creating workspace failed",
          variant: "error",
        })
        log.error("workspace create request failed", {
          type,
          error: errorData(err),
        })
        return undefined
      })

    const workspace = result?.data
    if (!workspace) {
      setCreating(undefined)
      toast.show({
        message: `Failed to create workspace: ${errorMessage(result?.error ?? "no response")}`,
        variant: "error",
      })
      return
    }

    await project.workspace.sync()
    await props.onSelect(workspace.id)
    setCreating(undefined)
  }

  return (
    <DialogSelect
      title={`${creating() ? "Creating Environment" : "New Environment"} · ${scope() === "global" ? "Global" : "Project"}`}
      skipFilter={true}
      options={options()}
      onSelect={(option) => {
        if (option.value === "creating" || option.value === "loading") return
        if (option.value === "worktree") {
          dialog.replace(() => (
            <DialogPrompt
              title="Name project copy"
              placeholder="leave blank to generate a name"
              onConfirm={(value) => void create(option.value, value.trim())}
              onCancel={() => dialog.replace(() => <DialogWorkspaceCreate {...props} />)}
            />
          ))
          return
        }
        void create(option.value)
      }}
    />
  )
}
