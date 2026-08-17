import { For, Show, type Component, createMemo } from "solid-js"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { SettingsRow, useSettingsDirectory } from "./settings-helpers"

export const SettingsCommands: Component = () => {
  const language = useLanguage()
  const globalSync = useGlobalSync()
  const directory = useSettingsDirectory()

  const items = createMemo(() => {
    const dir = directory()
    if (!dir) return []
    const [child] = globalSync.child(dir)
    return (child.command ?? []).slice().sort((a, b) => a.name.localeCompare(b.name))
  })

  return (
    <div class="flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10">
      <div class="sticky top-0 z-10 bg-[linear-gradient(to_bottom,var(--surface-raised-stronger-non-alpha)_calc(100%_-_24px),transparent)]">
        <div class="flex flex-col gap-1 pt-6 pb-8 max-w-[720px]">
          <h2 class="text-16-medium text-text-strong">{language.t("settings.commands.title")}</h2>
          <p class="text-14-regular text-text-weak">{language.t("settings.commands.description")}</p>
        </div>
      </div>

      <div class="flex flex-col gap-8 w-full max-w-[720px]">
        <Show
          when={directory()}
          fallback={<p class="text-14-regular text-text-weak">{language.t("settings.worktrees.empty.project")}</p>}
        >
          <Show
            when={items().length > 0}
            fallback={<p class="text-14-regular text-text-weak">{language.t("settings.commands.empty")}</p>}
          >
            <div class="bg-surface-raised-base px-4 rounded-lg">
              <For each={items()}>
                {(command) => (
                  <SettingsRow
                    title={`/${command.name}`}
                    description={[command.description, command.agent, command.model].filter(Boolean).join(" · ")}
                  >
                    <span class="text-12-regular text-text-weaker">
                      {command.subtask
                        ? language.t("settings.commands.tag.subtask")
                        : language.t("settings.commands.tag.slash")}
                    </span>
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
