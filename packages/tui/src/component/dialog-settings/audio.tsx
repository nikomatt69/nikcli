/**
 * Audio settings — ambient sound feedback on session lifecycle events.
 *
 * Lives in `nikcli.json` under `tui`, not in the per-terminal KV store the
 * UI/Prompt/Sidebar dialogs use: the runtime in `app.tsx` already gates the two
 * `Sound.pulse()` call sites (permission.asked, session.idle) on
 * `config.tui.sound`, so persisting here means the next event picks the new
 * value up with no restart.
 */
import { createMemo, createSignal } from "solid-js"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import { useSDK } from "@tui/context/sdk"
import { useSync } from "@tui/context/sync"
import { useToast } from "@tui/ui/toast"

type AudioOption = "sound"

export function DialogSettingsAudio() {
  const dialog = useDialog()
  const sdk = useSDK()
  const sync = useSync()
  const toast = useToast()
  const [saving, setSaving] = createSignal(false)

  // Schema default is `true`; an absent field is treated as on, matching the
  // runtime check in `app.tsx` (`tuiCfg?.sound === false`).
  const sound = () => sync.data.config.tui?.sound !== false

  const options = createMemo((): DialogSelectOption<AudioOption>[] => [
    {
      title: "Sound Effects",
      value: "sound",
      // Status only: `footer` is a short badge column here, and a sentence in
      // it squeezes the title down to a few characters.
      description: sound() ? "ON" : "OFF",
      searchText: "sound audio chime bell pulse notification feedback volume mute",
    },
  ])

  async function write(patch: { sound?: boolean }, success: string) {
    if (saving()) return
    setSaving(true)
    try {
      const { error } = await sdk.client.config.update({
        payload: { tui: patch } as any,
      })
      if (error) {
        toast.show({
          message: `Failed to update settings: ${(error as any).message ?? error}`,
          variant: "error",
        })
        return
      }
      // The store is only refilled at bootstrap and on instance switch, so the
      // dialog has to pull the merged result back itself or the row would keep
      // showing the pre-write value.
      const config = await sdk.client.config.get({}, { throwOnError: true })
      sync.set("config", config.data as any)
      toast.show({ message: success, variant: "success" })
      dialog.clear()
    } catch (error: any) {
      toast.show({
        message: `Failed to update settings: ${error?.message ?? String(error)}`,
        variant: "error",
      })
    } finally {
      setSaving(false)
    }
  }

  const toggle = async (option: AudioOption) => {
    if (option !== "sound") return
    const next = !sound()
    await write({ sound: next }, `Sound effects ${next ? "enabled" : "disabled"}`)
  }

  return <DialogSelect title="Audio Settings" options={options()} onSelect={(option) => void toggle(option.value)} />
}
