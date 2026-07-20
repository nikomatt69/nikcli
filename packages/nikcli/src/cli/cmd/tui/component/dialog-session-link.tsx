import { createMemo, onMount } from "solid-js"
import { useDialog } from "@tui/ui/dialog"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import type { Part } from "@nikcli-ai/sdk/v2"
import { useSync } from "@tui/context/sync"
import { useKV } from "@tui/context/kv"
import { useSDK } from "../context/sdk"
import { useToast } from "../ui/toast"
import { Identifier } from "@/id/id"
import { Keybind } from "@/util/keybind"
import { linkSessions, sessionLinkOf, unlinkSession } from "../util/session-link"

const MAX_RELAY_CHARS = 4000

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

  function relayText(): string {
    const source = sync.session.get(props.sessionID)
    const label = source?.title || `Session ${props.sessionID.slice(-5)}`
    const messages = sync.data.message[props.sessionID] ?? []
    const last = messages.at(-1)
    const parts = last ? (sync.data.part[last.id] ?? []) : []
    const isTextPart = (part: Part): part is Extract<Part, { type: "text" }> => part.type === "text"
    const text = parts
      .filter(isTextPart)
      .map((part) => part.text)
      .join("\n")
      .trim()
    if (!text) {
      return `<system-reminder>Session "${label}" linked to this session and wants to connect. There is no recent message to relay yet.</system-reminder>`
    }
    const truncated = text.length > MAX_RELAY_CHARS ? `${text.slice(0, MAX_RELAY_CHARS)}\n…(truncated)` : text
    return `<system-reminder>Message relayed from linked session "${label}":</system-reminder>\n${truncated}`
  }

  async function relayTo(targetID: string) {
    await sdk.client.session
      .promptAsync({
        sessionID: targetID,
        noReply: false,
        parts: [
          {
            id: Identifier.ascending("part"),
            type: "text",
            text: relayText(),
            synthetic: true,
          },
        ],
      })
      .catch(() => undefined)
  }

  onMount(() => {
    dialog.setSize("large")
  })

  return (
    <DialogSelect
      title="Link Session"
      placeholder="Select a session to link and relay the latest message to"
      options={options()}
      current={linkedID()}
      onSelect={(option) => {
        void (async () => {
          linkSessions(kv, props.sessionID, option.value)
          await relayTo(option.value)
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
