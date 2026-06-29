import { Component, createResource, For, JSXElement, Show } from "solid-js"
import { Dialog } from "@nikcli-ai/ui/dialog"
import { Icon } from "@nikcli-ai/ui/icon"
import { useSDK } from "@/context/sdk"
import { useLanguage } from "@/context/language"

type DoctorCheck = { ok: boolean; label: string; detail?: string; fix?: string }
type DoctorReport = { ok: boolean; version: string; channel: string; failures: number; results: DoctorCheck[] }
type Tone = "success" | "danger" | "muted"

const SummaryCard: Component<{ label: string; value: string | number; tone?: Tone }> = (props) => (
  <div class="flex min-w-0 flex-col gap-0.5 rounded-md border border-border-base bg-surface-raised-base px-3 py-2">
    <span class="truncate text-11-regular text-text-weaker">{props.label}</span>
    <span
      class="truncate text-15-medium tabular-nums"
      classList={{
        "text-icon-success": props.tone === "success",
        "text-icon-error": props.tone === "danger",
        "text-text-base": !props.tone || props.tone === "muted",
      }}
    >
      {props.value}
    </span>
  </div>
)

const StatusPill: Component<{ tone: Tone; children: JSXElement }> = (props) => (
  <span
    class="inline-flex h-6 max-w-[120px] items-center gap-1.5 rounded-md border border-border-base bg-surface-base px-2 text-11-medium"
    classList={{
      "text-icon-success": props.tone === "success",
      "text-icon-error": props.tone === "danger",
      "text-text-weaker": props.tone === "muted",
    }}
  >
    <span
      class="size-1.5 rounded-full shrink-0"
      classList={{
        "bg-icon-success": props.tone === "success",
        "bg-icon-error": props.tone === "danger",
        "bg-icon-weak": props.tone === "muted",
      }}
    />
    <span class="truncate">{props.children}</span>
  </span>
)

export const DialogDoctor: Component = () => {
  const sdk = useSDK()
  const language = useLanguage()

  const [report] = createResource(async () => {
    const res = await sdk.client.doctor.run()
    return res.data as DoctorReport | undefined
  })

  return (
    <Dialog
      size="large"
      title={language.t("dialog.doctor.title")}
      description={
        report()
          ? report()!.ok
            ? language.t("dialog.doctor.allPassed", { count: report()!.results.length })
            : language.t("dialog.doctor.someFailed", { count: report()!.failures })
          : language.t("dialog.doctor.description")
      }
    >
      <div class="flex w-[680px] max-w-[calc(100vw-56px)] flex-col gap-y-4 max-h-[70vh] overflow-auto no-scrollbar py-1">
        <Show
          when={report()}
          fallback={<span class="text-12-regular text-text-weak">{language.t("common.loading.ellipsis")}</span>}
        >
          {(current) => (
            <>
              <div class="grid grid-cols-2 gap-2 md:grid-cols-4">
                <SummaryCard label={language.t("dialog.doctor.version")} value={current().version} />
                <SummaryCard label={language.t("dialog.doctor.channel")} value={current().channel} />
                <SummaryCard
                  label={language.t("dialog.doctor.checks")}
                  value={current().results.length}
                  tone={current().ok ? "success" : "muted"}
                />
                <SummaryCard
                  label={language.t("dialog.doctor.failures")}
                  value={current().failures}
                  tone={current().failures > 0 ? "danger" : "success"}
                />
              </div>

              <div class="flex flex-col gap-1">
                <For each={current().results}>
                  {(check) => (
                    <div class="flex min-w-0 items-start justify-between gap-3 rounded-md border border-border-base bg-surface-raised-base px-3 py-2">
                      <div class="flex min-w-0 items-start gap-x-2">
                        <Icon
                          name={check.ok ? "check" : "close"}
                          size="small"
                          class={check.ok ? "text-icon-success shrink-0 mt-0.5" : "text-icon-error shrink-0 mt-0.5"}
                        />
                        <div class="flex min-w-0 flex-col gap-0.5">
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
                      <StatusPill tone={check.ok ? "success" : "danger"}>
                        {check.ok ? language.t("dialog.doctor.passed") : language.t("dialog.doctor.failed")}
                      </StatusPill>
                    </div>
                  )}
                </For>
              </div>
            </>
          )}
        </Show>
      </div>
    </Dialog>
  )
}
