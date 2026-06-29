import { Component, createMemo, createSignal, JSXElement } from "solid-js"
import { Dialog } from "@nikcli-ai/ui/dialog"
import { Switch } from "@nikcli-ai/ui/switch"
import { showToast } from "@nikcli-ai/ui/toast"
import { useSync } from "@/context/sync"
import { useSDK } from "@/context/sdk"
import { useLanguage } from "@/context/language"

type Tone = "success" | "warning" | "danger" | "muted"

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

const StatusPill: Component<{ tone: Tone; children: JSXElement }> = (props) => (
  <span
    class="inline-flex h-6 max-w-[190px] items-center gap-1.5 rounded-md border border-border-base bg-surface-base px-2 text-11-medium"
    classList={{
      "text-icon-success": props.tone === "success",
      "text-icon-warning": props.tone === "warning",
      "text-icon-error": props.tone === "danger",
      "text-text-weaker": props.tone === "muted",
    }}
  >
    <span
      class="size-1.5 rounded-full shrink-0"
      classList={{
        "bg-icon-success": props.tone === "success",
        "bg-icon-warning": props.tone === "warning",
        "bg-icon-error": props.tone === "danger",
        "bg-icon-weak": props.tone === "muted",
      }}
    />
    <span class="truncate">{props.children}</span>
  </span>
)

const SummaryCard: Component<{ label: string; value: string; tone?: Tone }> = (props) => (
  <div class="flex min-w-0 flex-col gap-0.5 rounded-md border border-border-base bg-surface-raised-base px-3 py-2">
    <span class="truncate text-11-regular text-text-weaker">{props.label}</span>
    <span
      class="truncate text-15-medium"
      classList={{
        "text-icon-success": props.tone === "success",
        "text-icon-warning": props.tone === "warning",
        "text-icon-error": props.tone === "danger",
        "text-text-base": !props.tone || props.tone === "muted",
      }}
    >
      {props.value}
    </span>
  </div>
)

export const DialogOpenTelemetry: Component = () => {
  const sync = useSync()
  const sdk = useSDK()
  const language = useLanguage()
  const [busy, setBusy] = createSignal(false)

  // AI SDK telemetry defaults to on; only an explicit `false` disables it.
  const enabled = createMemo(
    () => (sync.data.config as { experimental?: { openTelemetry?: boolean } })?.experimental?.openTelemetry !== false,
  )

  const toggle = async () => {
    if (busy()) return
    setBusy(true)
    const next = !enabled()
    try {
      await sdk.client.config.update({ config: { experimental: { openTelemetry: next } } } as never)
    } catch (err) {
      showToast({ variant: "error", title: language.t("common.requestFailed"), description: errorMessage(err) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog size="large" title={language.t("dialog.otel.title")} description={language.t("dialog.otel.description")}>
      <div class="flex w-full min-w-0 flex-col gap-y-4">
        <div class="grid grid-cols-2 gap-2">
          <SummaryCard
            label={language.t("dialog.otel.toggle")}
            value={enabled() ? language.t("common.on") : language.t("common.off")}
            tone={enabled() ? "success" : "muted"}
          />
          <SummaryCard
            label={language.t("dialog.otel.endpoint")}
            value={language.t("dialog.otel.endpoint.environment")}
            tone="muted"
          />
        </div>

        <div class="flex items-center justify-between gap-x-3 rounded-md border border-border-base bg-surface-raised-base px-3 py-2">
          <div class="flex min-w-0 flex-col gap-0.5">
            <span class="text-13-medium text-text-base">{language.t("dialog.otel.toggle")}</span>
            <span class="text-11-regular text-text-weak">{language.t("dialog.otel.toggle.hint")}</span>
          </div>
          <div class="flex shrink-0 items-center gap-2">
            <StatusPill tone={enabled() ? "success" : "muted"}>
              {enabled() ? language.t("common.on") : language.t("common.off")}
            </StatusPill>
            <Switch checked={enabled()} disabled={busy()} onChange={toggle} />
          </div>
        </div>

        <div class="flex items-center justify-between gap-x-3 rounded-md border border-border-base bg-surface-raised-base px-3 py-2">
          <div class="flex min-w-0 flex-col gap-0.5">
            <span class="text-13-medium text-text-base">{language.t("dialog.otel.endpoint")}</span>
            <span class="text-11-regular text-text-weak">{language.t("dialog.otel.endpoint.hint")}</span>
          </div>
          <StatusPill tone="muted">{language.t("dialog.otel.endpoint.environment")}</StatusPill>
        </div>
      </div>
    </Dialog>
  )
}
