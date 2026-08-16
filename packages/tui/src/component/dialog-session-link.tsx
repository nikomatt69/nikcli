import { createMemo, onMount } from "solid-js"
import { useDialog } from "@tui/ui/dialog"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { useSync } from "@tui/context/sync"
import { useKV } from "@tui/context/kv"
import { useSDK } from "../context/sdk"
import { useToast } from "../ui/toast"
import { Keybind } from "@tui/util/keybind"
import { buildRelayText, linkSessions, relayToSession, sessionLinkOf, unlinkSession } from "../util/session-link"

/** Picker used from the session tab bar to link two sessions and relay the latest turn between them on demand. */
export function DialogSessionLink(props: { sessionID: string }) {
  const dialog = useDialog()
  const sync = useSync()
  const kv = useKV()
  const sdk = useSDK()
  const toast = useToast()

  const linkedID = createMemo(() => sessionLinkOf(kv, props.sessionID))

  const options = createMemo<DialogSelectOption<string>[]>(() => {
    return sync.data.session
      .filter((session) => session.id !== props.sessionID && session.parentID === undefined)
      .toSorted((a, b) => b.time.updated - a.time.updated)
      .map((session) => ({
        title: session.title || `Session ${session.id.slice(-5)}`,
        value: session.id,
        description: session.id === linkedID() ? "Linked" : undefined,
      }))
  })

  onMount(() => {
    dialog.setSize("large")
  })

  return (
    <DialogSelect
      title="Link Session"
      placeholder="Select a session to link — they'll stay in sync and nudge each other when one finishes a turn"
      options={options()}
      current={linkedID()}
      onSelect={(option) => {
        void (async () => {
          linkSessions(kv, props.sessionID, option.value)
          await relayToSession(sdk, option.value, buildRelayText(sync, props.sessionID, "link"))
          toast.show({
            message: `Linked & sent to "${option.title}"`,
            variant: "info",
          })
          dialog.clear()
        })()
      }}
      keybind={[
        {
          keybind: Keybind.parse("ctrl+u")[0],
          title: "unlink",
          disabled: !linkedID(),
          onTrigger: () => {
            unlinkSession(kv, props.sessionID)
            toast.show({ message: "Session unlinked", variant: "info" })
            dialog.clear()
          },
        },
      ]}
    />
  )
}
