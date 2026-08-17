import { Switch } from "@nikcli-ai/ui/switch"
import { For, Show, type Component, createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { SettingsRow, useSettingsDirectory } from "./settings-helpers"

export const SettingsMcp: Component = () => {
  const language = useLanguage()
  const globalSDK = useGlobalSDK()
  const globalSync = useGlobalSync()
  const directory = useSettingsDirectory()
  const [store, setStore] = createStore({ loading: undefined as string | undefined })

  const child = createMemo(() => {
    const dir = directory()
    if (!dir) return
    return globalSync.child(dir)
  })

  const items = createMemo(() =>
    Object.entries(child()?.[0]?.mcp ?? {})
      .map(([name, status]) => ({ name, status: status.status }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  )

  const statusLabel = (status: string | undefined) => {
    if (status === "connected") return language.t("mcp.status.connected")
    if (status === "failed") return language.t("mcp.status.failed")
    if (status === "needs_auth") return language.t("mcp.status.needs_auth")
    if (status === "disabled") return language.t("mcp.status.disabled")
    return status ?? language.t("mcp.status.disabled")
  }

  const toggle = async (name: string) => {
    const dir = directory()
    const current = child()
    if (!dir || !current || store.loading) return
    setStore("loading", name)
    try {
      const status = current[0].mcp[name]
      if (status?.status === "connected") {
        await globalSDK.client.mcp.disconnect({ name, directory: dir })
      } else {
        await globalSDK.client.mcp.connect({ name, directory: dir })
      }
      const result = await globalSDK.client.mcp.status({ directory: dir })
      if (result.data) current[1]("mcp", result.data)
    } finally {
      setStore("loading", undefined)
    }
  }

  return (
    <div class="flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10">
      <div class="sticky top-0 z-10 bg-[linear-gradient(to_bottom,var(--surface-raised-stronger-non-alpha)_calc(100%_-_24px),transparent)]">
        <div class="flex flex-col gap-1 pt-6 pb-8 max-w-[720px]">
          <h2 class="text-16-medium text-text-strong">{language.t("settings.mcp.title")}</h2>
          <p class="text-14-regular text-text-weak">{language.t("settings.mcp.description")}</p>
        </div>
      </div>

      <div class="flex flex-col gap-8 w-full max-w-[720px]">
        <Show
          when={directory()}
          fallback={<p class="text-14-regular text-text-weak">{language.t("settings.worktrees.empty.project")}</p>}
        >
          <Show
            when={items().length > 0}
            fallback={<p class="text-14-regular text-text-weak">{language.t("dialog.mcp.empty")}</p>}
          >
            <div class="bg-surface-raised-base px-4 rounded-lg">
              <For each={items()}>
                {(item) => {
                  const mcp = () => child()?.[0].mcp[item.name]
                  const status = () => mcp()?.status
                  const error = () => {
                    const value = mcp()
                    return value?.status === "failed" ? value.error : undefined
                  }
                  return (
                    <SettingsRow
                      title={item.name}
                      description={[statusLabel(status()), error()].filter(Boolean).join(" · ")}
                    >
                      <Switch
                        checked={status() === "connected"}
                        disabled={store.loading === item.name}
                        onChange={() => void toggle(item.name)}
                      />
                    </SettingsRow>
                  )
                }}
              </For>
            </div>
          </Show>
        </Show>
      </div>
    </div>
  )
}
