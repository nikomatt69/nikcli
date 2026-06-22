import { Component, createMemo, createResource, createSignal, Show } from "solid-js"
import { Dialog } from "@nikcli-ai/ui/dialog"
import { List } from "@nikcli-ai/ui/list"
import { Button } from "@nikcli-ai/ui/button"
import { useSDK } from "@/context/sdk"
import { useLanguage } from "@/context/language"

type ConnectorStatus =
  | { status: "connected" }
  | { status: "disabled" }
  | { status: "failed"; error: string }
  | { status: "needs_auth" }

const STATUS_COLOR: Record<string, string> = {
  connected: "bg-icon-success",
  failed: "bg-icon-error",
  disabled: "bg-icon-weak",
  needs_auth: "bg-icon-warning",
}

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

  const disconnect = async (name: string) => {
    if (busy()) return
    setBusy(name)
    try {
      await sdk.client.connectors.auth.remove({ name })
      await refetch()
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
        return status.error
    }
  }

  return (
    <Dialog
      title={language.t("dialog.connectors.title")}
      description={language.t("dialog.connectors.description", { count: items().length })}
    >
      <List
        search={{ placeholder: language.t("common.search.placeholder"), autofocus: true }}
        emptyMessage={data.loading ? language.t("common.loading.ellipsis") : language.t("dialog.connectors.empty")}
        key={(x) => x?.name ?? ""}
        items={items}
        filterKeys={["name"]}
        sortBy={(a, b) => a.name.localeCompare(b.name)}
      >
        {(item) => (
          <div class="w-full flex items-center justify-between gap-x-3">
            <div class="flex items-center gap-x-2 min-w-0">
              <span
                class="size-2 rounded-full shrink-0"
                classList={{ [STATUS_COLOR[item.status.status] ?? "bg-icon-weak"]: true }}
              />
              <span class="truncate text-13-medium text-text-base">{item.name}</span>
              <span class="truncate text-11-regular text-text-weaker">{statusLabel(item.status)}</span>
            </div>
            <Show when={item.status.status === "connected"}>
              <div onClick={(e) => e.stopPropagation()}>
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
    </Dialog>
  )
}
