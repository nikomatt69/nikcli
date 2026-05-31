import { createMemo, createSignal } from "solid-js"
import { useDialog } from "@tui/ui/dialog"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { useRoute } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { useSDK } from "../context/sdk"
import { useToast } from "../ui/toast"
import { DialogWorkspaceCreate } from "./dialog-workspace-list"
import { DialogWorkspaceFileChanges } from "./dialog-workspace-file-changes"

/**
 * Move the current session to another workspace, or detach it back to the local project.
 */
export function DialogSessionWarp(props: { sessionID: string }) {
  const dialog = useDialog()
  const route = useRoute()
  const sync = useSync()
  const sdk = useSDK()
  const toast = useToast()
  const [pending, setPending] = createSignal(false)

  const currentWorkspaceID = createMemo(() => {
    const session = sync.session.get(props.sessionID)
    return session?.workspaceID
  })

  const options = createMemo<DialogSelectOption<string>[]>(() => {
    const workspaces = sync.data.workspaceList ?? []
    const items: DialogSelectOption<string>[] = []

    items.push({
      title: "Local project (detach)",
      value: "__local__",
      description: !currentWorkspaceID() ? "Already here" : undefined,
      disabled: !currentWorkspaceID(),
    })

    for (const ws of workspaces) {
      items.push({
        title: ws.id,
        value: ws.id,
        description: ws.id === currentWorkspaceID() ? "Already here" : ws.config.type,
        disabled: ws.id === currentWorkspaceID(),
      })
    }

    items.push({
      title: "+ New workspace",
      value: "__create__",
      description: "Create a workspace and move this session there",
    })

    return items
  })

  async function confirmCopyChanges() {
    const sourceWorkspaceID = currentWorkspaceID()
    if (!sourceWorkspaceID) return false

    const status = await sdk.client.vcs.status({ workspace: sourceWorkspaceID }).catch(() => undefined)
    const files = status?.data ?? []
    if (files.length === 0) return false

    const choice = await DialogWorkspaceFileChanges.show(dialog, files)
    if (!choice) return undefined
    return choice === "yes"
  }

  async function warp(target: string, copyChanges: boolean) {
    if (pending()) return
    setPending(true)
    const workspaceID = target === "__local__" ? null : target
    try {
      const result = await sdk.client.experimental.workspace.warp({
        id: workspaceID,
        sessionID: props.sessionID,
        copyChanges,
      })
      if (result.error) {
        toast.show({ message: "Failed to warp session", variant: "error" })
        return
      }
      const refreshed = await sdk.client.session.get({ sessionID: props.sessionID }).catch(() => undefined)
      if (refreshed?.data) {
        sync.set(
          "session",
          [...sync.data.session.filter((item) => item.id !== refreshed.data!.id), refreshed.data].toSorted((a, b) =>
            a.id.localeCompare(b.id),
          ),
        )
      }
      toast.show({
        message: workspaceID ? `Moved to workspace` : `Detached to local project`,
        variant: "info",
      })
      route.navigate({
        type: "session",
        sessionID: props.sessionID,
        workspaceID: workspaceID ?? undefined,
      })
      dialog.clear()
    } catch (error) {
      toast.show({
        message: error instanceof Error ? error.message : "Failed to warp session",
        variant: "error",
      })
    } finally {
      setPending(false)
    }
  }

  return (
    <DialogSelect
      title={pending() ? "Warping..." : "Move session to"}
      options={options()}
      onSelect={(option) => {
        if (option.disabled || pending()) return
        if (option.value === "__create__") {
          dialog.replace(() => (
            <DialogWorkspaceCreate
              onSelect={async (workspaceID) => {
                await sync.workspace.sync()
                const copyChanges = await confirmCopyChanges()
                if (copyChanges === undefined) return
                await warp(workspaceID, copyChanges)
              }}
            />
          ))
          return
        }
        void (async () => {
          const copyChanges = await confirmCopyChanges()
          if (copyChanges === undefined) return
          await warp(option.value, copyChanges)
        })()
      }}
    />
  )
}
