import type { Config } from "@nikcli-ai/sdk/httpapi"
import { Switch } from "@nikcli-ai/ui/switch"
import { showToast } from "@nikcli-ai/ui/toast"
import { type Component, For } from "solid-js"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { SettingsRow } from "./settings-helpers"

type Experimental = NonNullable<Config["experimental"]>

const FEATURES = [
  {
    key: "brain",
    title: "settings.features.brain.title",
    description: "settings.features.brain.description",
    fallback: true,
  },
  {
    key: "memory",
    title: "settings.features.memory.title",
    description: "settings.features.memory.description",
    fallback: true,
  },
  {
    key: "batch_tool",
    title: "settings.features.batchTool.title",
    description: "settings.features.batchTool.description",
    fallback: false,
  },
  {
    key: "openTelemetry",
    title: "settings.features.openTelemetry.title",
    description: "settings.features.openTelemetry.description",
    fallback: true,
  },
  {
    key: "nativeLlm",
    title: "settings.features.nativeLlm.title",
    description: "settings.features.nativeLlm.description",
    fallback: false,
  },
  {
    key: "continue_loop_on_deny",
    title: "settings.features.continueOnDeny.title",
    description: "settings.features.continueOnDeny.description",
    fallback: false,
  },
  {
    key: "disable_paste_summary",
    title: "settings.features.pasteSummary.title",
    description: "settings.features.pasteSummary.description",
    fallback: false,
    invert: true,
  },
] as const

export const SettingsFeatures: Component = () => {
  const globalSync = useGlobalSync()
  const language = useLanguage()

  const experimental = () => (globalSync.data.config.experimental ?? {}) as Experimental

  const checked = (feature: (typeof FEATURES)[number]) => {
    const value = experimental()[feature.key]
    const enabled = typeof value === "boolean" ? value : feature.fallback
    return "invert" in feature && feature.invert ? !enabled : enabled
  }

  const setFlag = (feature: (typeof FEATURES)[number], next: boolean) => {
    const value = "invert" in feature && feature.invert ? !next : next
    const before = experimental()
    globalSync.set("config", "experimental", { ...before, [feature.key]: value })
    globalSync.updateConfig({ experimental: { [feature.key]: value } }).catch((err: unknown) => {
      globalSync.set("config", "experimental", before)
      const message = err instanceof Error ? err.message : String(err)
      showToast({ title: language.t("settings.features.toast.updateFailed.title"), description: message })
    })
  }

  return (
    <div class="flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10">
      <div class="sticky top-0 z-10 bg-[linear-gradient(to_bottom,var(--surface-raised-stronger-non-alpha)_calc(100%_-_24px),transparent)]">
        <div class="flex flex-col gap-1 pt-6 pb-8 max-w-[720px]">
          <h2 class="text-16-medium text-text-strong">{language.t("settings.features.title")}</h2>
          <p class="text-14-regular text-text-weak">{language.t("settings.features.description")}</p>
        </div>
      </div>

      <div class="flex flex-col gap-8 w-full max-w-[720px]">
        <div class="bg-surface-raised-base px-4 rounded-lg">
          <For each={FEATURES}>
            {(feature) => (
              <SettingsRow title={language.t(feature.title)} description={language.t(feature.description)}>
                <Switch checked={checked(feature)} onChange={(value) => setFlag(feature, value)} />
              </SettingsRow>
            )}
          </For>
        </div>
      </div>
    </div>
  )
}
