/**
 * Diagnostics settings — cost and correctness instrumentation for a session.
 *
 * These live in `nikcli.json` under `tui`, not in the local KV store the other
 * settings dialogs use: they change what the *session view* renders for every
 * client of this project, so a per-terminal preference would be the wrong
 * scope. Config-backed also means the toggle survives a reinstall, which is the
 * point for something you turn on to chase a billing anomaly over days.
 *
 * Ported in spirit from opencode's DevTools debug bar (#38359/#38398), minus
 * the overlay: nikcli already had the per-turn table (`util/turn-usage.ts`),
 * it was just unreachable without hand-editing JSON.
 */
import { createMemo, createSignal } from "solid-js"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import { useSDK } from "@tui/context/sdk"
import { useSync } from "@tui/context/sync"
import { useToast } from "@tui/ui/toast"

type DiagnosticsOption = "turn_tokens"

export function DialogSettingsDiagnostics() {
  const dialog = useDialog()
  const sdk = useSDK()
  const sync = useSync()
  const toast = useToast()
  const [saving, setSaving] = createSignal(false)

  const turnTokens = () => sync.data.config.tui?.turn_tokens === true

  const options = createMemo((): DialogSelectOption<DiagnosticsOption>[] => [
    {
      title: "Per-Turn Token Breakdown",
      value: "turn_tokens",
      // Status only: `footer` is a short badge column here, and a sentence in
      // it squeezes the title down to a few characters.
      description: turnTokens() ? "ON" : "OFF",
      searchText: "tokens cache bust cost usage turn breakdown billing",
    },
  ])

  async function write(patch: { turn_tokens?: boolean }, success: string) {
    if (saving()) return
    setSaving(true)
    try {
      const { error } = await sdk.client.config.update({ payload: { tui: patch } as any })
      if (error) {
        toast.show({ message: `Failed to update settings: ${(error as any).message ?? error}`, variant: "error" })
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
      toast.show({ message: `Failed to update settings: ${error?.message ?? String(error)}`, variant: "error" })
    } finally {
      setSaving(false)
    }
  }

  const toggle = async (option: DiagnosticsOption) => {
    if (option !== "turn_tokens") return
    const next = !turnTokens()
    await write({ turn_tokens: next }, `Per-turn token breakdown ${next ? "enabled" : "disabled"}`)
  }

  return (
    <DialogSelect title="Diagnostics Settings" options={options()} onSelect={(option) => void toggle(option.value)} />
  )
}
