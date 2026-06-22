import { Component, createMemo, For, Show } from "solid-js"
import { Dialog } from "@nikcli-ai/ui/dialog"
import { useSync } from "@/context/sync"
import { usePlatform } from "@/context/platform"
import { useLanguage } from "@/context/language"

type PluginEntry = { name: string; version?: string }

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

const MCP_STATUS_COLOR: Record<string, string> = {
  connected: "bg-icon-success",
  failed: "bg-icon-error",
  disabled: "bg-icon-weak",
  needs_auth: "bg-icon-warning",
  needs_client_registration: "bg-icon-error",
}

export const DialogStatus: Component = () => {
  const sync = useSync()
  const platform = usePlatform()
  const language = useLanguage()

  const mcpEntries = createMemo(() =>
    Object.entries(sync.data.mcp ?? {}).sort(([a], [b]) => a.localeCompare(b)),
  )
  const lspEntries = createMemo(() => sync.data.lsp ?? [])
  const plugins = createMemo(() => parsePlugins(sync.data.config?.plugin))

  return (
    <Dialog title={language.t("dialog.status.title")} description={`nikcli v${platform.version ?? "?"}`}>
      <div class="flex flex-col gap-y-5 min-w-0 max-h-[60vh] overflow-auto no-scrollbar py-1">
        <section class="flex flex-col gap-y-1.5">
          <span class="text-13-medium text-text-base">
            {language.t("dialog.status.mcp", { count: mcpEntries().length })}
          </span>
          <Show
            when={mcpEntries().length > 0}
            fallback={<span class="text-12-regular text-text-weak">{language.t("dialog.status.mcp.empty")}</span>}
          >
            <For each={mcpEntries()}>
              {([name, item]) => (
                <div class="flex items-center gap-x-2 min-w-0">
                  <span
                    class="size-2 rounded-full shrink-0"
                    classList={{ [MCP_STATUS_COLOR[item.status] ?? "bg-icon-weak"]: true }}
                  />
                  <span class="text-12-medium text-text-base truncate">{name}</span>
                  <span class="text-12-regular text-text-weak truncate">
                    {item.status === "failed" && "error" in item ? String(item.error) : item.status}
                  </span>
                </div>
              )}
            </For>
          </Show>
        </section>

        <section class="flex flex-col gap-y-1.5">
          <span class="text-13-medium text-text-base">
            {language.t("dialog.status.lsp", { count: lspEntries().length })}
          </span>
          <Show
            when={lspEntries().length > 0}
            fallback={<span class="text-12-regular text-text-weak">{language.t("dialog.status.lsp.empty")}</span>}
          >
            <For each={lspEntries()}>
              {(item) => (
                <div class="flex items-center gap-x-2 min-w-0">
                  <span
                    class="size-2 rounded-full shrink-0"
                    classList={{ "bg-icon-success": item.status === "connected", "bg-icon-error": item.status !== "connected" }}
                  />
                  <span class="text-12-medium text-text-base truncate">{item.id}</span>
                  <span class="text-12-regular text-text-weak truncate">{item.root}</span>
                </div>
              )}
            </For>
          </Show>
        </section>

        <section class="flex flex-col gap-y-1.5">
          <span class="text-13-medium text-text-base">
            {language.t("dialog.status.plugins", { count: plugins().length })}
          </span>
          <Show
            when={plugins().length > 0}
            fallback={<span class="text-12-regular text-text-weak">{language.t("dialog.status.plugins.empty")}</span>}
          >
            <For each={plugins()}>
              {(item) => (
                <div class="flex items-center gap-x-2 min-w-0">
                  <span class="size-2 rounded-full shrink-0 bg-icon-success" />
                  <span class="text-12-medium text-text-base truncate">{item.name}</span>
                  <Show when={item.version}>
                    <span class="text-12-regular text-text-weak truncate">@{item.version}</span>
                  </Show>
                </div>
              )}
            </For>
          </Show>
        </section>
      </div>
    </Dialog>
  )
}
