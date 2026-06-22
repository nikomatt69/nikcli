import { Component, createMemo, createSignal, Show } from "solid-js"
import { Dialog } from "@nikcli-ai/ui/dialog"
import { List } from "@nikcli-ai/ui/list"
import { Button } from "@nikcli-ai/ui/button"
import { useDialog } from "@nikcli-ai/ui/context/dialog"
import { useLocal } from "@/context/local"
import { useSDK } from "@/context/sdk"
import { useLanguage } from "@/context/language"

export const DialogAdvisorModel: Component = () => {
  const local = useLocal()
  const sdk = useSDK()
  const dialog = useDialog()
  const language = useLanguage()
  const [busy, setBusy] = createSignal(false)

  const agentName = createMemo(() => local.agent.current()?.name)
  const advisor = createMemo(() => local.agent.current()?.advisor?.model)

  const models = createMemo(() =>
    local.model.list().filter((m) => local.model.visible({ modelID: m.id, providerID: m.provider.id })),
  )

  const apply = async (config: Record<string, unknown>) => {
    const name = agentName()
    if (!name || busy()) return
    setBusy(true)
    try {
      await sdk.client.config.update({ config: { agent: { [name]: config } } } as never)
      dialog.close()
    } finally {
      setBusy(false)
    }
  }

  const setAdvisor = (providerID: string, modelID: string) => apply({ advisor: `${providerID}/${modelID}` })
  const clearAdvisor = () => apply({ advisor: null, advisor_max_uses: null })

  return (
    <Show
      when={agentName()}
      fallback={
        <Dialog title={language.t("dialog.advisor.title")}>
          <span class="text-12-regular text-text-weak px-3 py-2 block">{language.t("dialog.advisor.noAgent")}</span>
        </Dialog>
      }
    >
      <Dialog
        title={language.t("dialog.advisor.title")}
        description={language.t("dialog.advisor.description", { agent: agentName() ?? "" })}
      >
        <List
          search={{ placeholder: language.t("dialog.model.search.placeholder"), autofocus: true }}
          emptyMessage={language.t("dialog.model.empty")}
          key={(x) => `${x.provider.id}:${x.id}`}
          items={models}
          filterKeys={["provider.name", "name", "id"]}
          sortBy={(a, b) => a.name.localeCompare(b.name)}
          groupBy={(x) => x.provider.name}
          onSelect={(x) => {
            if (x) setAdvisor(x.provider.id, x.id)
          }}
        >
          {(i) => {
            const current = () => advisor()?.providerID === i.provider.id && advisor()?.modelID === i.id
            return (
              <div class="w-full flex items-center gap-x-2 text-13-regular">
                <span class="truncate">{i.name}</span>
                <Show when={current()}>
                  <span class="text-11-regular text-text-weaker">{language.t("dialog.advisor.current")}</span>
                </Show>
              </div>
            )
          }}
        </List>
        <Show when={advisor()}>
          <Button
            variant="ghost"
            class="ml-3 mt-4 mb-5 text-text-base self-start"
            disabled={busy()}
            onClick={clearAdvisor}
          >
            {language.t("dialog.advisor.clear")}
          </Button>
        </Show>
      </Dialog>
    </Show>
  )
}
