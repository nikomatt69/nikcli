import { Component, createMemo, createResource, createSignal, JSXElement, Show } from "solid-js"
import { Dialog } from "@nikcli-ai/ui/dialog"
import { List } from "@nikcli-ai/ui/list"
import { Switch } from "@nikcli-ai/ui/switch"
import { IconButton } from "@nikcli-ai/ui/icon-button"
import { showToast } from "@nikcli-ai/ui/toast"
import { useSDK } from "@/context/sdk"
import { useLanguage } from "@/context/language"

type LoopDefinition = {
  id: string
  name: string
  trigger: { kind: "manual" } | { kind: "interval"; everyMs: number }
  paused?: boolean
  enabled: boolean
  stages: Array<{ name: string }>
}
type LoopRuntime = {
  loopID: string
  status: "idle" | "running" | "paused" | "error" | "cancelling"
  runs: number
  lastRunAt?: number
  lastError?: string
}
type Tone = "success" | "warning" | "danger" | "muted"

function formatInterval(ms: number): string {
  const minutes = Math.round(ms / 60_000)
  if (minutes < 60) return `every ${minutes}m`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `every ${hours}h`
  return `every ${Math.round(hours / 24)}d`
}

function relativeTime(ts: number | undefined): string | undefined {
  if (!ts) return undefined
  const seconds = Math.max(0, Math.floor((Date.now() - ts) / 1000))
  if (seconds < 60) return "just now"
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

const SummaryCard: Component<{ label: string; value: number; tone?: Tone }> = (props) => (
  <div class="flex min-w-0 flex-col gap-0.5 rounded-md border border-border-base bg-surface-raised-base px-3 py-2">
    <span class="truncate text-11-regular text-text-weaker">{props.label}</span>
    <span
      class="text-15-medium tabular-nums"
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

const StatusPill: Component<{ tone: Tone; children: JSXElement }> = (props) => (
  <span
    class="inline-flex h-6 max-w-[150px] items-center gap-1.5 rounded-md border border-border-base bg-surface-base px-2 text-11-medium"
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

export const DialogRoutines: Component = () => {
  const sdk = useSDK()
  const language = useLanguage()
  const [busy, setBusy] = createSignal<string | null>(null)

  const [data, { refetch }] = createResource(async () => {
    const res = await sdk.client.loop.list()
    return (res.data ?? { loops: [], runtimes: [] }) as { loops: LoopDefinition[]; runtimes: LoopRuntime[] }
  })

  const loops = createMemo(() => data()?.loops ?? [])
  const runtimes = createMemo(() => data()?.runtimes ?? [])
  const runtimeFor = (id: string) => runtimes().find((r) => r.loopID === id)
  const enabledCount = createMemo(() => loops().filter((loop) => loop.enabled && !loop.paused).length)
  const runningCount = createMemo(() => runtimes().filter((runtime) => runtime.status === "running").length)
  const errorCount = createMemo(
    () => runtimes().filter((runtime) => runtime.status === "error" || runtime.lastError).length,
  )

  const loopStatus = (loop: LoopDefinition, runtime?: LoopRuntime): LoopRuntime["status"] => {
    if (!loop.enabled || loop.paused) return "paused"
    return runtime?.status ?? "idle"
  }

  const statusTone = (status: LoopRuntime["status"]): Tone => {
    switch (status) {
      case "running":
        return "warning"
      case "error":
        return "danger"
      case "paused":
        return "muted"
      case "cancelling":
        return "warning"
      default:
        return "success"
    }
  }

  const statusLabel = (status: LoopRuntime["status"]) => {
    switch (status) {
      case "running":
        return language.t("dialog.routines.status.running")
      case "paused":
        return language.t("dialog.routines.status.paused")
      case "error":
        return language.t("dialog.routines.status.error")
      case "cancelling":
        return language.t("dialog.routines.status.cancelling")
      default:
        return language.t("dialog.routines.status.idle")
    }
  }

  const run = async (id: string) => {
    if (busy()) return
    setBusy(id)
    try {
      await sdk.client.loop.run({ id })
      await refetch()
    } catch (err) {
      showToast({ variant: "error", title: language.t("common.requestFailed"), description: errorMessage(err) })
    } finally {
      setBusy(null)
    }
  }

  const remove = async (id: string) => {
    if (busy()) return
    setBusy(id)
    try {
      await sdk.client.loop.delete({ id })
      await refetch()
    } catch (err) {
      showToast({ variant: "error", title: language.t("common.requestFailed"), description: errorMessage(err) })
    } finally {
      setBusy(null)
    }
  }

  const toggle = async (loop: LoopDefinition) => {
    if (busy()) return
    setBusy(loop.id)
    try {
      await sdk.client.loop.toggle({ id: loop.id, enabled: !loop.enabled })
      await refetch()
    } catch (err) {
      showToast({ variant: "error", title: language.t("common.requestFailed"), description: errorMessage(err) })
    } finally {
      setBusy(null)
    }
  }

  return (
    <Dialog
      size="large"
      title={language.t("dialog.routines.title")}
      description={language.t("dialog.routines.description", { count: loops().length })}
    >
      <div class="flex w-full min-w-0 flex-col gap-y-4">
        <div class="grid grid-cols-3 gap-2">
          <SummaryCard label={language.t("dialog.routines.enabled")} value={enabledCount()} tone="success" />
          <SummaryCard label={language.t("dialog.routines.running")} value={runningCount()} tone="warning" />
          <SummaryCard
            label={language.t("dialog.routines.errors")}
            value={errorCount()}
            tone={errorCount() > 0 ? "danger" : "muted"}
          />
        </div>

        <List
          class="[&_[data-slot=list-scroll]]:max-h-[380px] [&_[data-slot=list-scroll]]:overflow-y-auto [&_[data-slot=list-item]]:items-start [&_[data-slot=list-item]]:py-2"
          search={{ placeholder: language.t("common.search.placeholder"), autofocus: true }}
          emptyMessage={data.loading ? language.t("common.loading.ellipsis") : language.t("dialog.routines.empty")}
          key={(x) => x?.id ?? ""}
          items={loops}
          filterKeys={["name"]}
          sortBy={(a, b) => a.name.localeCompare(b.name)}
        >
          {(loop) => {
            const runtime = () => runtimeFor(loop.id)
            const status = () => loopStatus(loop, runtime())
            const schedule = () => (loop.trigger.kind === "interval" ? formatInterval(loop.trigger.everyMs) : "manual")
            const last = () => relativeTime(runtime()?.lastRunAt)
            return (
              <div class="w-full flex items-start justify-between gap-x-3">
                <div class="flex min-w-0 flex-col gap-1">
                  <div class="flex min-w-0 flex-wrap items-center gap-2">
                    <span class="truncate text-13-medium text-text-base">{loop.name}</span>
                    <StatusPill tone={statusTone(status())}>{statusLabel(status())}</StatusPill>
                  </div>
                  <div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-11-regular text-text-weaker">
                    <span class="shrink-0">{schedule()}</span>
                    <span class="shrink-0">{language.t("dialog.routines.runs", { count: runtime()?.runs ?? 0 })}</span>
                    <span class="shrink-0">{language.t("dialog.routines.stages", { count: loop.stages.length })}</span>
                    <Show when={last()}>{(value) => <span class="shrink-0">{value()}</span>}</Show>
                  </div>
                  <Show when={runtime()?.lastError}>
                    {(message) => <span class="break-words text-11-regular text-icon-error">{message()}</span>}
                  </Show>
                </div>
                <div class="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                  <IconButton
                    icon="enter"
                    variant="ghost"
                    iconSize="normal"
                    class="size-7"
                    disabled={busy() === loop.id || runtime()?.status === "running"}
                    aria-label={language.t("dialog.routines.run")}
                    onClick={() => run(loop.id)}
                  />
                  <IconButton
                    icon="trash"
                    variant="ghost"
                    iconSize="normal"
                    class="size-7"
                    disabled={busy() === loop.id}
                    aria-label={language.t("dialog.routines.delete")}
                    onClick={() => remove(loop.id)}
                  />
                  <Switch checked={loop.enabled} disabled={busy() === loop.id} onChange={() => toggle(loop)} />
                </div>
              </div>
            )
          }}
        </List>
      </div>
    </Dialog>
  )
}
