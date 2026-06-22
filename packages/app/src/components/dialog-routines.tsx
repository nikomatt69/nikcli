import { Component, createMemo, createResource, createSignal, For, Show } from "solid-js"
import { Dialog } from "@nikcli-ai/ui/dialog"
import { List } from "@nikcli-ai/ui/list"
import { Switch } from "@nikcli-ai/ui/switch"
import { IconButton } from "@nikcli-ai/ui/icon-button"
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

export const DialogRoutines: Component = () => {
  const sdk = useSDK()
  const language = useLanguage()
  const [busy, setBusy] = createSignal<string | null>(null)

  const [data, { refetch }] = createResource(async () => {
    const res = await sdk.client.loop.list()
    return (res.data ?? { loops: [], runtimes: [] }) as { loops: LoopDefinition[]; runtimes: LoopRuntime[] }
  })

  const loops = createMemo(() => data()?.loops ?? [])
  const runtimeFor = (id: string) => data()?.runtimes.find((r) => r.loopID === id)

  const run = async (id: string) => {
    if (busy()) return
    setBusy(id)
    try {
      await sdk.client.loop.run({ id })
      await refetch()
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
    } finally {
      setBusy(null)
    }
  }

  return (
    <Dialog
      title={language.t("dialog.routines.title")}
      description={language.t("dialog.routines.description", { count: loops().length })}
    >
      <List
        search={{ placeholder: language.t("common.search.placeholder"), autofocus: true }}
        emptyMessage={data.loading ? language.t("common.loading.ellipsis") : language.t("dialog.routines.empty")}
        key={(x) => x?.id ?? ""}
        items={loops}
        filterKeys={["name"]}
        sortBy={(a, b) => a.name.localeCompare(b.name)}
      >
        {(loop) => {
          const runtime = () => runtimeFor(loop.id)
          const schedule = () =>
            loop.trigger.kind === "interval" ? formatInterval(loop.trigger.everyMs) : "manual"
          const last = () => relativeTime(runtime()?.lastRunAt)
          return (
            <div class="w-full flex items-center justify-between gap-x-3">
              <div class="flex flex-col gap-0.5 min-w-0">
                <div class="flex items-center gap-2 min-w-0">
                  <span class="truncate text-13-medium">{loop.name}</span>
                  <span class="text-11-regular text-text-weaker shrink-0">{schedule()}</span>
                  <Show when={runtime()?.status === "running"}>
                    <span class="text-11-regular text-icon-warning shrink-0">
                      {language.t("dialog.routines.running")}
                    </span>
                  </Show>
                </div>
                <div class="flex items-center gap-2 text-11-regular text-text-weaker min-w-0">
                  <span class="shrink-0">
                    {language.t("dialog.routines.runs", { count: runtime()?.runs ?? 0 })}
                  </span>
                  <Show when={last()}>
                    <span class="truncate">· {last()}</span>
                  </Show>
                  <Show when={runtime()?.lastError}>
                    <span class="truncate text-icon-error">· {runtime()!.lastError}</span>
                  </Show>
                </div>
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
                <Switch
                  checked={loop.enabled}
                  disabled={busy() === loop.id}
                  onChange={() => toggle(loop)}
                />
              </div>
            </div>
          )
        }}
      </List>
    </Dialog>
  )
}
