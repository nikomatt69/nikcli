import { DialogPrompt } from "@tui/ui/dialog-prompt"
import { useDialog } from "@tui/ui/dialog"
import { useSync } from "@tui/context/sync"
import { createMemo } from "solid-js"
import { useSDK } from "../context/sdk"
import { createNikcliClient } from "@nikcli-ai/sdk/httpapi"

interface DialogSessionRenameProps {
  session: string
  workspaceID?: string
}

export function DialogSessionRename(props: DialogSessionRenameProps) {
  const dialog = useDialog()
  const sync = useSync()
  const sdk = useSDK()
  const session = createMemo(() => sync.session.get(props.session))
  const client = createMemo(() => {
    if (!props.workspaceID) return sdk.client
    return createNikcliClient({
      baseUrl: sdk.url,
      fetch: sdk.fetch,
      directory: sync.data.path.directory || sdk.directory,
      workspace: props.workspaceID,
    })
  })

  return (
    <DialogPrompt
      title="Rename Session"
      value={session()?.title}
      onConfirm={(value) => {
        client().session.update({
          sessionID: props.session,
          title: value,
        })
        dialog.clear()
      }}
      onCancel={() => dialog.clear()}
    />
  )
}
