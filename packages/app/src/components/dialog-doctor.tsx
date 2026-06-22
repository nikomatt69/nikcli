import { Component, createResource, For, Show } from "solid-js"
import { Dialog } from "@nikcli-ai/ui/dialog"
import { Icon } from "@nikcli-ai/ui/icon"
import { useSDK } from "@/context/sdk"
import { useLanguage } from "@/context/language"

type DoctorCheck = { ok: boolean; label: string; detail?: string; fix?: string }
type DoctorReport = { ok: boolean; version: string; channel: string; failures: number; results: DoctorCheck[] }

export const DialogDoctor: Component = () => {
  const sdk = useSDK()
  const language = useLanguage()

  const [report] = createResource(async () => {
    const res = await sdk.client.doctor.run()
    return res.data as DoctorReport | undefined
  })

  return (
    <Dialog
      title={language.t("dialog.doctor.title")}
      description={
        report()
          ? report()!.ok
            ? language.t("dialog.doctor.allPassed", { count: report()!.results.length })
            : language.t("dialog.doctor.someFailed", { count: report()!.failures })
          : language.t("dialog.doctor.description")
      }
    >
      <div class="flex flex-col gap-y-2 min-w-0 max-h-[60vh] overflow-auto no-scrollbar py-1">
        <Show
          when={report()}
          fallback={
            <span class="text-12-regular text-text-weak">{language.t("common.loading.ellipsis")}</span>
          }
        >
          <For each={report()!.results}>
            {(check) => (
              <div class="flex items-start gap-x-2 min-w-0">
                <Icon
                  name={check.ok ? "check" : "close"}
                  size="small"
                  class={check.ok ? "text-icon-success shrink-0 mt-0.5" : "text-icon-error shrink-0 mt-0.5"}
                />
                <div class="flex flex-col gap-0.5 min-w-0">
                  <span class="text-12-medium text-text-base">{check.label}</span>
                  <Show when={check.detail}>
                    <span class="text-11-regular text-text-weak break-words">{check.detail}</span>
                  </Show>
                  <Show when={check.fix}>
                    <span class="text-11-regular text-icon-warning break-words">
                      {language.t("dialog.doctor.fix")}: {check.fix}
                    </span>
                  </Show>
                </div>
              </div>
            )}
          </For>
        </Show>
      </div>
    </Dialog>
  )
}
