import { Component, createMemo, For, JSXElement, Show } from "solid-js"
import { Dialog } from "@nikcli-ai/ui/dialog"
import { useSync } from "@/context/sync"
import { usePlatform } from "@/context/platform"
import { useLanguage } from "@/context/language"

type PluginEntry = { name: string; version?: string }
type Tone = "success" | "warning" | "danger" | "muted"

function parsePlugins(list: unknown): PluginEntry[] {
  const entries = Array.isArray(list) ? list : []
  const result = entries.map<PluginEntry>((item) => {
    const value = typeof item === "string" ? item : Array.isArray(item) ? String(item[0]) : String(item)
    if (value.startsWith("file://")) {
      const path = value.substring("file://".length)
      const parts = path.split("/")
      const filename = parts.pop() || path
      if (!filename.includes(".")) return { name: filename }
      const basename = filename.split(".")[0]
      if (basename === "index") {
        const dirname = parts.pop()
        return { name: dirname || basename }
      }
      return { name: basename }
    }
    const index = value.lastIndexOf("@")
    if (index <= 0) return { name: value, version: "latest" }
    return { name: value.substring(0, index), version: value.substring(index + 1) }
  })
  return result.toSorted((a, b) => a.name.localeCompare(b.name))
}

function mcpTone(status: string): Tone {
  switch (status) {
    case "connected":
      return "success"
    case "needs_auth":
      return "warning"
    case "failed":
    case "needs_client_registration":
      return "danger"
    default:
      return "muted"
  }
}

function lspTone(status: string): Tone {
  return status === "connected" ? "success" : "danger"
}

const StatusDot: Component<{ tone: Tone }> = (props) => (
  <span
    class="size-2 rounded-full shrink-0"
    classList={{
      "bg-icon-success": props.tone === "success",
      "bg-icon-warning": props.tone === "warning",
      "bg-icon-error": props.tone === "danger",
      "bg-icon-weak": props.tone === "muted",
    }}
  />
)

const StatusPill: Component<{ tone: Tone; children: JSXElement }> = (props) => (
  <span
    class="inline-flex h-6 max-w-[220px] items-center gap-1.5 rounded-md border border-border-base bg-surface-base px-2 text-11-medium"
    classList={{
      "text-icon-success": props.tone === "success",
      "text-icon-warning": props.tone === "warning",
      "text-icon-error": props.tone === "danger",
      "text-text-weaker": props.tone === "muted",
    }}
  >
    <StatusDot tone={props.tone} />
    <span class="truncate">{props.children}</span>
  </span>
)

const Metric: Component<{ label: string; value: string | number; detail?: string; tone?: Tone }> = (props) => (
  <div class="flex min-w-0 flex-col gap-0.5 rounded-md border border-border-base bg-surface-raised-base px-3 py-2">
    <span class="text-11-regular text-text-weaker">{props.label}</span>
    <span
      class="truncate text-15-medium tabular-nums"
      classList={{
        "text-icon-success": props.tone === "success",
        "text-icon-warning": props.tone === "warning",
        "text-icon-error": props.tone === "danger",
        "text-text-base": !props.tone || props.tone === "muted",
      }}
    >
      {props.value}
    </span>
    <Show when={props.detail}>
      <span class="truncate text-11-regular text-text-weaker">{props.detail}</span>
    </Show>
  </div>
)

const Section: Component<{ title: string; description?: string; children: JSXElement }> = (props) => (
  <section class="flex min-w-0 flex-col gap-y-2">
    <div class="flex min-w-0 items-end justify-between gap-3">
      <div class="flex min-w-0 flex-col gap-0.5">
        <span class="truncate text-13-medium text-text-base">{props.title}</span>
        <Show when={props.description}>
          <span class="truncate text-11-regular text-text-weaker">{props.description}</span>
        </Show>
      </div>
    </div>
    <div class="flex flex-col gap-1">{props.children}</div>
  </section>
)

const EmptyState: Component<{ children: JSXElement }> = (props) => (
  <div class="rounded-md border border-border-base bg-surface-raised-base px-3 py-2 text-12-regular text-text-weak">
    {props.children}
  </div>
)

function statusError(item: { status: string; error?: unknown }): string | undefined {
  if (item.status !== "failed" || item.error === undefined) return undefined
  return String(item.error)
}

export const DialogStatus: Component = () => {
  const sync = useSync()
  const platform = usePlatform()
  const language = useLanguage()

  const mcpEntries = createMemo(() => Object.entries(sync.data.mcp ?? {}).sort(([a], [b]) => a.localeCompare(b)))
  const lspEntries = createMemo(() => sync.data.lsp ?? [])
  const plugins = createMemo(() => parsePlugins(sync.data.config?.plugin))
  const mcpSummary = createMemo(() => {
    const entries = mcpEntries()
    const connected = entries.filter(([, item]) => item.status === "connected").length
    const attention = entries.filter(([, item]) => item.status !== "connected" && item.status !== "disabled").length
    return { total: entries.length, connected, attention }
  })
  const lspSummary = createMemo(() => {
    const entries = lspEntries()
    const connected = entries.filter((item) => item.status === "connected").length
    const attention = entries.length - connected
    return { total: entries.length, connected, attention }
  })

  const metricTone = (total: number, attention: number): Tone => {
    if (total === 0) return "muted"
    return attention > 0 ? "warning" : "success"
  }

  const mcpStatusLabel = (status: string) => {
    switch (status) {
      case "connected":
        return language.t("mcp.status.connected")
      case "failed":
        return language.t("mcp.status.failed")
      case "needs_auth":
        return language.t("mcp.status.needs_auth")
      case "needs_client_registration":
        return language.t("mcp.status.needs_client_registration")
      case "disabled":
        return language.t("mcp.status.disabled")
      default:
        return status
    }
  }

  return (
    <Dialog size="large" title={language.t("dialog.status.title")} description={`nikcli v${platform.version ?? "?"}`}>
      <div class="flex w-full min-w-0 flex-col gap-y-5">
        <div class="grid grid-cols-2 gap-2 md:grid-cols-4">
          <Metric label={language.t("dialog.status.version")} value={platform.version ?? "?"} />
          <Metric
            label={language.t("dialog.status.mcp.metric")}
            value={`${mcpSummary().connected}/${mcpSummary().total}`}
            detail={
              mcpSummary().attention > 0
                ? language.t("dialog.status.issues", { count: mcpSummary().attention })
                : language.t("dialog.status.operational")
            }
            tone={metricTone(mcpSummary().total, mcpSummary().attention)}
          />
          <Metric
            label={language.t("dialog.status.lsp.metric")}
            value={`${lspSummary().connected}/${lspSummary().total}`}
            detail={
              lspSummary().attention > 0
                ? language.t("dialog.status.issues", { count: lspSummary().attention })
                : language.t("dialog.status.operational")
            }
            tone={metricTone(lspSummary().total, lspSummary().attention)}
          />
          <Metric
            label={language.t("dialog.status.plugins.metric")}
            value={plugins().length}
            detail={language.t("dialog.status.configured")}
          />
        </div>

        <Section
          title={language.t("dialog.status.mcp", { count: mcpEntries().length })}
          description={language.t("dialog.status.mcp.description")}
        >
          <Show
            when={mcpEntries().length > 0}
            fallback={<EmptyState>{language.t("dialog.status.mcp.empty")}</EmptyState>}
          >
            <For each={mcpEntries()}>
              {([name, item]) => (
                <div class="flex min-w-0 items-start justify-between gap-3 rounded-md border border-border-base bg-surface-raised-base px-3 py-2">
                  <div class="flex min-w-0 flex-col gap-0.5">
                    <span class="truncate text-12-medium text-text-base">{name}</span>
                    <Show when={statusError(item)}>
                      {(error) => <span class="break-words text-11-regular text-icon-error">{error()}</span>}
                    </Show>
                  </div>
                  <StatusPill tone={mcpTone(item.status)}>{mcpStatusLabel(item.status)}</StatusPill>
                </div>
              )}
            </For>
          </Show>
        </Section>

        <Section
          title={language.t("dialog.status.lsp", { count: lspEntries().length })}
          description={language.t("dialog.status.lsp.description")}
        >
          <Show
            when={lspEntries().length > 0}
            fallback={<EmptyState>{language.t("dialog.status.lsp.empty")}</EmptyState>}
          >
            <For each={lspEntries()}>
              {(item) => (
                <div class="flex min-w-0 items-center justify-between gap-3 rounded-md border border-border-base bg-surface-raised-base px-3 py-2">
                  <div class="flex min-w-0 flex-col gap-0.5">
                    <span class="truncate text-12-medium text-text-base">{item.id}</span>
                    <span class="truncate text-11-regular text-text-weaker">{item.root}</span>
                  </div>
                  <StatusPill tone={lspTone(item.status)}>{item.status}</StatusPill>
                </div>
              )}
            </For>
          </Show>
        </Section>

        <Section
          title={language.t("dialog.status.plugins", { count: plugins().length })}
          description={language.t("dialog.status.plugins.description")}
        >
          <Show
            when={plugins().length > 0}
            fallback={<EmptyState>{language.t("dialog.status.plugins.empty")}</EmptyState>}
          >
            <For each={plugins()}>
              {(item) => (
                <div class="flex min-w-0 items-center justify-between gap-3 rounded-md border border-border-base bg-surface-raised-base px-3 py-2">
                  <span class="truncate text-12-medium text-text-base">{item.name}</span>
                  <Show when={item.version}>
                    <span class="shrink-0 text-11-regular text-text-weaker">@{item.version}</span>
                  </Show>
                </div>
              )}
            </For>
          </Show>
        </Section>
      </div>
    </Dialog>
  )
}
