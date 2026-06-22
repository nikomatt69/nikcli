import { Component, createMemo, createResource, For, Show } from "solid-js"
import { Dialog } from "@nikcli-ai/ui/dialog"
import { useSDK } from "@/context/sdk"
import { useLanguage } from "@/context/language"

type TokenBreakdown = {
  input: number
  output: number
  reasoning: number
  cacheRead: number
  cacheWrite: number
}
type GlobalAnalytics = {
  totals: { sessions: number; messages: number; tokens: TokenBreakdown; cost: number; toolCalls: number }
  byProvider: Record<string, { sessions: number; messages: number; tokens: number; cost: number }>
  byModel: Record<
    string,
    { messages: number; tokens: { input: number; output: number; reasoning: number }; cost: number }
  >
}

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 })

function compact(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`
  return String(value)
}

function totalTokens(t: TokenBreakdown): number {
  return t.input + t.output + t.reasoning + t.cacheRead + t.cacheWrite
}

const Stat: Component<{ label: string; value: string }> = (props) => (
  <div class="flex flex-col gap-0.5 rounded-md border border-border-base bg-surface-raised-base px-3 py-2">
    <span class="text-11-regular text-text-weaker">{props.label}</span>
    <span class="text-15-medium text-text-base tabular-nums">{props.value}</span>
  </div>
)

export const DialogAnalytics: Component = () => {
  const sdk = useSDK()
  const language = useLanguage()

  const [data] = createResource(async () => {
    const res = await sdk.client.analytics.global()
    return res.data as GlobalAnalytics | undefined
  })

  const totals = createMemo(() => data()?.totals)
  const topModels = createMemo(() =>
    Object.entries(data()?.byModel ?? {})
      .map(([id, m]) => ({
        id,
        cost: m.cost,
        messages: m.messages,
        tokens: m.tokens.input + m.tokens.output + m.tokens.reasoning,
      }))
      .sort((a, b) => b.cost - a.cost)
      .slice(0, 6),
  )
  const topProviders = createMemo(() =>
    Object.entries(data()?.byProvider ?? {})
      .map(([id, p]) => ({ id, cost: p.cost, messages: p.messages, tokens: p.tokens }))
      .sort((a, b) => b.cost - a.cost)
      .slice(0, 6),
  )

  return (
    <Dialog title={language.t("dialog.analytics.title")} description={language.t("dialog.analytics.description")}>
      <div class="flex flex-col gap-y-5 min-w-0 max-h-[60vh] overflow-auto no-scrollbar py-1">
        <Show
          when={totals()}
          fallback={
            <span class="text-12-regular text-text-weak">
              {data.loading ? language.t("common.loading.ellipsis") : language.t("dialog.analytics.empty")}
            </span>
          }
        >
          {(t) => (
            <>
              <div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
                <Stat label={language.t("dialog.analytics.sessions")} value={compact(t().sessions)} />
                <Stat label={language.t("dialog.analytics.messages")} value={compact(t().messages)} />
                <Stat label={language.t("dialog.analytics.tokens")} value={compact(totalTokens(t().tokens))} />
                <Stat label={language.t("dialog.analytics.cost")} value={money.format(t().cost)} />
                <Stat label={language.t("dialog.analytics.toolCalls")} value={compact(t().toolCalls)} />
              </div>

              <Show when={topModels().length > 0}>
                <section class="flex flex-col gap-y-1.5">
                  <span class="text-13-medium text-text-base">{language.t("dialog.analytics.byModel")}</span>
                  <For each={topModels()}>
                    {(m) => (
                      <div class="flex items-center justify-between gap-x-3 text-12-regular">
                        <span class="truncate text-text-base">{m.id}</span>
                        <span class="shrink-0 text-text-weak tabular-nums">
                          {compact(m.tokens)} · {money.format(m.cost)}
                        </span>
                      </div>
                    )}
                  </For>
                </section>
              </Show>

              <Show when={topProviders().length > 0}>
                <section class="flex flex-col gap-y-1.5">
                  <span class="text-13-medium text-text-base">{language.t("dialog.analytics.byProvider")}</span>
                  <For each={topProviders()}>
                    {(p) => (
                      <div class="flex items-center justify-between gap-x-3 text-12-regular">
                        <span class="truncate text-text-base">{p.id}</span>
                        <span class="shrink-0 text-text-weak tabular-nums">
                          {compact(p.tokens)} · {money.format(p.cost)}
                        </span>
                      </div>
                    )}
                  </For>
                </section>
              </Show>
            </>
          )}
        </Show>
      </div>
    </Dialog>
  )
}
