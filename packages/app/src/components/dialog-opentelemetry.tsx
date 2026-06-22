import { Component, createMemo, createSignal } from "solid-js"
import { Dialog } from "@nikcli-ai/ui/dialog"
import { Switch } from "@nikcli-ai/ui/switch"
import { useSync } from "@/context/sync"
import { useSDK } from "@/context/sdk"
import { useLanguage } from "@/context/language"

export const DialogOpenTelemetry: Component = () => {
  const sync = useSync()
  const sdk = useSDK()
  const language = useLanguage()
  const [busy, setBusy] = createSignal(false)

  // AI SDK telemetry defaults to on; only an explicit `false` disables it.
  const enabled = createMemo(() => (sync.data.config as { experimental?: { openTelemetry?: boolean } })?.experimental?.openTelemetry !== false)

  const toggle = async () => {
    if (busy()) return
    setBusy(true)
    const next = !enabled()
    try {
      await sdk.client.config.update({ config: { experimental: { openTelemetry: next } } } as never)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog title={language.t("dialog.otel.title")} description={language.t("dialog.otel.description")}>
      <div class="flex flex-col gap-y-4 py-1">
        <div class="flex items-center justify-between gap-x-3">
          <div class="flex flex-col gap-0.5 min-w-0">
            <span class="text-13-medium text-text-base">{language.t("dialog.otel.toggle")}</span>
            <span class="text-11-regular text-text-weak">{language.t("dialog.otel.toggle.hint")}</span>
          </div>
          <Switch checked={enabled()} disabled={busy()} onChange={toggle} />
        </div>
        <div class="flex flex-col gap-0.5">
          <span class="text-13-medium text-text-base">{language.t("dialog.otel.endpoint")}</span>
          <span class="text-11-regular text-text-weak">{language.t("dialog.otel.endpoint.hint")}</span>
        </div>
      </div>
    </Dialog>
  )
}
