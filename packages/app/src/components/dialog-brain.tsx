import { Component, createMemo, createResource, createSignal, Show } from "solid-js"
import { Dialog } from "@nikcli-ai/ui/dialog"
import { Button } from "@nikcli-ai/ui/button"
import { useSDK } from "@/context/sdk"
import { useLanguage } from "@/context/language"

type BrainStatus = {
  enabled: boolean
  memoryEnabled: boolean
  minHours: number
  minSessions: number
  lastBrainAt: number
  hoursSinceLastBrain: number
  sessionsSinceLastBrain: number
  shouldTrigger: boolean
}
type BrainResult = {
  success: boolean
  sessionsReviewed: number
  hoursSinceLastBrain: number
  error?: string
}

const Row: Component<{ label: string; value: string; tone?: "ok" | "warn" | "muted" }> = (props) => (
  <div class="flex items-center justify-between gap-x-3 text-12-regular">
    <span class="text-text-weak">{props.label}</span>
    <span
      class="tabular-nums"
      classList={{
        "text-icon-success": props.tone === "ok",
        "text-icon-warning": props.tone === "warn",
        "text-text-weaker": props.tone === "muted",
        "text-text-base": !props.tone,
      }}
    >
      {props.value}
    </span>
  </div>
)

export const DialogBrain: Component = () => {
  const sdk = useSDK()
  const language = useLanguage()
  const [running, setRunning] = createSignal(false)
  const [result, setResult] = createSignal<BrainResult | undefined>()

  const [status, { refetch }] = createResource(async () => {
    const res = await sdk.client.brain.status()
    return res.data as BrainStatus | undefined
  })

  const lastRun = createMemo(() => {
    const at = status()?.lastBrainAt
    if (!at) return language.t("dialog.brain.never")
    return new Date(at).toLocaleString()
  })

  const run = async () => {
    if (running()) return
    setRunning(true)
    try {
      const res = await sdk.client.brain.trigger({ force: true })
      setResult(res.data as BrainResult | undefined)
      await refetch()
    } finally {
      setRunning(false)
    }
  }

  return (
    <Dialog title={language.t("dialog.brain.title")} description={language.t("dialog.brain.description")}>
      <div class="flex flex-col gap-y-4">
        <Show
          when={status()}
          fallback={
            <span class="text-12-regular text-text-weak">
              {status.loading ? language.t("common.loading.ellipsis") : language.t("dialog.brain.unavailable")}
            </span>
          }
        >
          {(s) => (
            <div class="flex flex-col gap-y-1.5">
              <Row
                label={language.t("dialog.brain.enabled")}
                value={s().enabled ? language.t("common.on") : language.t("common.off")}
                tone={s().enabled ? "ok" : "muted"}
              />
              <Row
                label={language.t("dialog.brain.memory")}
                value={s().memoryEnabled ? language.t("common.on") : language.t("common.off")}
                tone={s().memoryEnabled ? "ok" : "muted"}
              />
              <Row label={language.t("dialog.brain.lastRun")} value={lastRun()} />
              <Row
                label={language.t("dialog.brain.sessionsSince")}
                value={`${s().sessionsSinceLastBrain} / ${s().minSessions}`}
              />
              <Row
                label={language.t("dialog.brain.ready")}
                value={s().shouldTrigger ? language.t("common.yes") : language.t("common.no")}
                tone={s().shouldTrigger ? "ok" : "muted"}
              />
            </div>
          )}
        </Show>

        <Show when={result()}>
          {(r) => (
            <div
              class="rounded-md border px-3 py-2 text-12-regular"
              classList={{
                "border-border-base text-text-base": r().success,
                "border-icon-error text-icon-error": !r().success,
              }}
            >
              <Show when={r().success} fallback={<span>{r().error ?? language.t("dialog.brain.failed")}</span>}>
                {language.t("dialog.brain.done", { count: r().sessionsReviewed })}
              </Show>
            </div>
          )}
        </Show>

        <Button class="self-start" disabled={running() || status()?.memoryEnabled === false} onClick={run}>
          {running() ? language.t("dialog.brain.running") : language.t("dialog.brain.run")}
        </Button>
      </div>
    </Dialog>
  )
}
