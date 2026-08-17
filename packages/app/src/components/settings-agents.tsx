import type { Agent } from "@nikcli-ai/sdk/httpapi"
import { Switch } from "@nikcli-ai/ui/switch"
import { showToast } from "@nikcli-ai/ui/toast"
import { For, Show, type Component, createMemo } from "solid-js"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { SettingsRow, useSettingsDirectory } from "./settings-helpers"

type AgentRow = Agent & { disabled?: boolean }

export const SettingsAgents: Component = () => {
  const language = useLanguage()
  const globalSDK = useGlobalSDK()
  const globalSync = useGlobalSync()
  const directory = useSettingsDirectory()

  const child = createMemo(() => {
    const dir = directory()
    if (!dir) return
    return globalSync.child(dir)[0]
  })

  const items = createMemo((): AgentRow[] => {
    const listed = (child()?.agent ?? []).filter((agent) => !agent.hidden)
    const seen = new Set(listed.map((agent) => agent.name))
    const disabled: AgentRow[] = []
    for (const [name, config] of Object.entries(globalSync.data.config.agent ?? {})) {
      if (!config?.disable || seen.has(name)) continue
      disabled.push({
        name,
        description: config.description,
        mode: config.mode ?? "all",
        permission: [],
        options: {},
        disabled: true,
      })
    }
    return [...listed, ...disabled].sort((a, b) => a.name.localeCompare(b.name))
  })

  const disabledNames = createMemo(() => {
    const names = new Set<string>()
    for (const [name, config] of Object.entries(globalSync.data.config.agent ?? {})) {
      if (config?.disable) names.add(name)
    }
    return names
  })

  const modeLabel = (mode: Agent["mode"]) => {
    if (mode === "primary") return language.t("settings.agents.mode.primary")
    if (mode === "subagent") return language.t("settings.agents.mode.subagent")
    return language.t("settings.agents.mode.all")
  }

  const setDisabled = (name: string, disabled: boolean) => {
    const before = globalSync.data.config.agent
    const next = { ...before, [name]: { ...before?.[name], disable: disabled } }
    globalSync.set("config", "agent", next)
    const dir = directory()
    globalSDK.client.config
      .update({ payload: { agent: { [name]: { disable: disabled } } }, directory: dir || undefined })
      .catch((err: unknown) => {
        globalSync.set("config", "agent", before)
        const message = err instanceof Error ? err.message : String(err)
        showToast({ title: language.t("settings.agents.toast.updateFailed.title"), description: message })
      })
  }

  return (
    <div class="flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10">
      <div class="sticky top-0 z-10 bg-[linear-gradient(to_bottom,var(--surface-raised-stronger-non-alpha)_calc(100%_-_24px),transparent)]">
        <div class="flex flex-col gap-1 pt-6 pb-8 max-w-[720px]">
          <h2 class="text-16-medium text-text-strong">{language.t("settings.agents.title")}</h2>
          <p class="text-14-regular text-text-weak">{language.t("settings.agents.description")}</p>
        </div>
      </div>

      <div class="flex flex-col gap-8 w-full max-w-[720px]">
        <Show
          when={directory()}
          fallback={<p class="text-14-regular text-text-weak">{language.t("settings.worktrees.empty.project")}</p>}
        >
          <Show
            when={items().length > 0}
            fallback={<p class="text-14-regular text-text-weak">{language.t("settings.agents.empty")}</p>}
          >
            <div class="bg-surface-raised-base px-4 rounded-lg">
              <For each={items()}>
                {(agent) => (
                  <SettingsRow
                    title={agent.name}
                    description={
                      [modeLabel(agent.mode), agent.description, agent.model && `${agent.model.providerID}/${agent.model.modelID}`]
                        .filter(Boolean)
                        .join(" · ")
                    }
                  >
                    <Switch
                      checked={!disabledNames().has(agent.name) && !agent.disabled}
                      onChange={(enabled) => setDisabled(agent.name, !enabled)}
                    />
                  </SettingsRow>
                )}
              </For>
            </div>
          </Show>
        </Show>
      </div>
    </div>
  )
}
