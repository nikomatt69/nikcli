import { Component, createMemo, createResource, createSignal, JSXElement, Show } from "solid-js"
import { Dialog } from "@nikcli-ai/ui/dialog"
import { List } from "@nikcli-ai/ui/list"
import { Button } from "@nikcli-ai/ui/button"
import { showToast } from "@nikcli-ai/ui/toast"
import { useSDK } from "@/context/sdk"
import { useLanguage } from "@/context/language"

type ConnectorStatus =
  | { status: "connected" }
  | { status: "disabled" }
  | { status: "failed"; error: string }
  | { status: "needs_auth" }
type Tone = "success" | "warning" | "danger" | "muted"

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

export const DialogConnectors: Component = () => {
  const sdk = useSDK()
  const language = useLanguage()
  const [busy, setBusy] = createSignal<string | null>(null)

  const [data, { refetch }] = createResource(async () => {
    const res = await sdk.client.connectors.status()
    return (res.data ?? {}) as Record<string, ConnectorStatus>
  })

  const items = createMemo(() =>
    Object.entries(data() ?? {})
      .map(([name, status]) => ({ name, status }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  )
  const connectedCount = createMemo(() => items().filter((item) => item.status.status === "connected").length)
  const authCount = createMemo(() => items().filter((item) => item.status.status === "needs_auth").length)
  const issueCount = createMemo(() => items().filter((item) => item.status.status === "failed").length)

  const disconnect = async (name: string) => {
    if (busy()) return
    setBusy(name)
    try {
      await sdk.client.connectors.auth.remove({ name })
      await refetch()
    } catch (err) {
      showToast({ variant: "error", title: language.t("common.requestFailed"), description: errorMessage(err) })
    } finally {
      setBusy(null)
    }
  }

  const statusLabel = (status: ConnectorStatus) => {
    switch (status.status) {
      case "connected":
        return language.t("connectors.status.connected")
      case "needs_auth":
        return language.t("connectors.status.needs_auth")
      case "disabled":
        return language.t("connectors.status.disabled")
      case "failed":
        return language.t("connectors.status.failed")
    }
  }

  const statusTone = (status: ConnectorStatus): Tone => {
    switch (status.status) {
      case "connected":
        return "success"
      case "needs_auth":
        return "warning"
      case "failed":
        return "danger"
      case "disabled":
        return "muted"
    }
  }

  return (
    <Dialog
      size="large"
      title={language.t("dialog.connectors.title")}
      description={language.t("dialog.connectors.description", { count: items().length })}
    >
      <div class="flex w-[640px] max-w-[calc(100vw-56px)] flex-col gap-y-4">
        <div class="grid grid-cols-3 gap-2">
          <SummaryCard label={language.t("dialog.connectors.connected")} value={connectedCount()} tone="success" />
          <SummaryCard label={language.t("dialog.connectors.needsAuth")} value={authCount()} tone="warning" />
          <SummaryCard
            label={language.t("dialog.connectors.issues")}
            value={issueCount()}
            tone={issueCount() > 0 ? "danger" : "muted"}
          />
        </div>

        <List
          class="[&_[data-slot=list-scroll]]:max-h-[360px] [&_[data-slot=list-scroll]]:overflow-y-auto [&_[data-slot=list-item]]:items-start [&_[data-slot=list-item]]:py-2"
          search={{ placeholder: language.t("common.search.placeholder"), autofocus: true }}
          emptyMessage={data.loading ? language.t("common.loading.ellipsis") : language.t("dialog.connectors.empty")}
          key={(x) => x?.name ?? ""}
          items={items}
          filterKeys={["name"]}
          sortBy={(a, b) => a.name.localeCompare(b.name)}
        >
          {(item) => (
            <div class="w-full flex items-start justify-between gap-x-3">
              <div class="flex min-w-0 flex-col gap-1">
                <div class="flex min-w-0 flex-wrap items-center gap-2">
                  <span class="truncate text-13-medium text-text-base">{item.name}</span>
                  <StatusPill tone={statusTone(item.status)}>{statusLabel(item.status)}</StatusPill>
                </div>
                <Show when={item.status.status === "failed" ? item.status.error : undefined}>
                  {(message) => <span class="break-words text-11-regular text-icon-error">{message()}</span>}
                </Show>
              </div>
              <Show when={item.status.status === "connected"}>
                <div class="shrink-0" onClick={(e) => e.stopPropagation()}>
                  <Button
                    variant="ghost"
                    class="h-7 text-12-medium"
                    disabled={busy() === item.name}
                    onClick={() => disconnect(item.name)}
                  >
                    {language.t("dialog.connectors.disconnect")}
                  </Button>
                </div>
              </Show>
            </div>
          )}
        </List>
      </div>
    </Dialog>
  )
}
