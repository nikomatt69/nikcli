import { Component, createMemo, createResource, For, Show } from "solid-js"
import { Dialog } from "@nikcli-ai/ui/dialog"
import { List } from "@nikcli-ai/ui/list"
import { useSDK } from "@/context/sdk"
import { useLanguage } from "@/context/language"

type SkillEntry = {
  name: string
  description: string
  location: string
  category?: string
  tags?: string[]
  version?: string
}

function sourceLabel(location: string): string {
  const normalized = location.replaceAll("\\", "/")
  if (normalized.includes("/.nikcli/skill")) return "Workspace"
  if (normalized.includes("/skills/")) return "Global"
  if (normalized.includes("/.claude/") || normalized.includes("/.agents/")) return "External"
  return "Other"
}

export const DialogSkills: Component = () => {
  const sdk = useSDK()
  const language = useLanguage()

  const [data] = createResource(async () => {
    const res = await sdk.client.app.skills()
    return (res.data ?? []) as SkillEntry[]
  })

  const items = createMemo(() => (data() ?? []).slice().sort((a, b) => a.name.localeCompare(b.name)))

  return (
    <Dialog
      title={language.t("dialog.skills.title")}
      description={language.t("dialog.skills.description", { count: items().length })}
    >
      <List
        search={{ placeholder: language.t("common.search.placeholder"), autofocus: true }}
        emptyMessage={data.loading ? language.t("common.loading.ellipsis") : language.t("dialog.skills.empty")}
        key={(x) => x?.name ?? ""}
        items={items}
        filterKeys={["name", "description", "category"]}
        sortBy={(a, b) => a.name.localeCompare(b.name)}
      >
        {(skill) => (
          <div class="w-full flex flex-col gap-0.5 min-w-0">
            <div class="flex items-center gap-2 min-w-0">
              <span class="truncate text-13-medium text-text-base">{skill.name}</span>
              <span class="shrink-0 text-11-regular text-text-weaker">{sourceLabel(skill.location)}</span>
              <Show when={skill.version}>
                <span class="shrink-0 text-11-regular text-text-weaker">v{skill.version}</span>
              </Show>
            </div>
            <Show when={skill.description}>
              <span class="truncate text-11-regular text-text-weak">{skill.description}</span>
            </Show>
            <Show when={skill.tags && skill.tags.length > 0}>
              <div class="flex items-center gap-1 flex-wrap">
                <For each={skill.tags!.slice(0, 5)}>
                  {(tag) => <span class="text-10-regular text-text-weaker">#{tag}</span>}
                </For>
              </div>
            </Show>
          </div>
        )}
      </List>
    </Dialog>
  )
}
