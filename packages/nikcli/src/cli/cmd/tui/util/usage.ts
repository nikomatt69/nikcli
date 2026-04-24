import type { AssistantMessage, Message, Provider, Model } from "@nikcli-ai/sdk/v2"

const COMPACTION_BUFFER = 20_000

export namespace Usage {
  export type Components = {
    input: number
    output: number
    reasoning: number
    cacheRead: number
    cacheWrite: number
  }

  export type ModelInfo = {
    providerID: string
    modelID: string
    name: string
    contextLimit: number
    model: Model
  }

  export type ContextUsage = {
    tokens: number
    components: Components
    cost: number
    model?: ModelInfo
    percent?: number
    free?: number
    autocompactReserved: number
  }

  function lastAssistant(messages: Message[] | undefined): AssistantMessage | undefined {
    if (!messages) return undefined
    return messages.findLast(
      (item): item is AssistantMessage => item.role === "assistant" && item.tokens.output > 0,
    )
  }

  function sumCost(messages: Message[] | undefined): number {
    if (!messages) return 0
    return messages.reduce((sum, item) => sum + (item.role === "assistant" ? item.cost : 0), 0)
  }

  function resolveModel(providers: Provider[], providerID: string, modelID: string): ModelInfo | undefined {
    const model = providers.find((p) => p.id === providerID)?.models[modelID]
    if (!model) return undefined
    return {
      providerID,
      modelID,
      name: model.name,
      contextLimit: model.limit.input ?? model.limit.context,
      model,
    }
  }

  export function fromMessages(messages: Message[] | undefined, providers: Provider[]): ContextUsage {
    const last = lastAssistant(messages)
    const cost = sumCost(messages)

    if (!last) {
      return {
        tokens: 0,
        components: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
        cost,
        autocompactReserved: 0,
      }
    }

    const t = last.tokens
    const tokens =
      t.total && t.total > 0 ? t.total : t.input + t.output + t.reasoning + t.cache.read + t.cache.write

    const model = resolveModel(providers, last.providerID, last.modelID)

    const autocompactReserved = model ? Math.min(COMPACTION_BUFFER, model.model.limit.output || 0) : 0

    const percent = model && model.contextLimit > 0 ? (tokens / model.contextLimit) * 100 : undefined
    const free = model && model.contextLimit > 0 ? Math.max(0, model.contextLimit - tokens) : undefined

    return {
      tokens,
      components: {
        input: t.input,
        output: t.output,
        reasoning: t.reasoning,
        cacheRead: t.cache.read,
        cacheWrite: t.cache.write,
      },
      cost,
      model,
      percent,
      free,
      autocompactReserved,
    }
  }

  export function formatTokens(n: number): string {
    if (n < 1_000) return n.toString()
    if (n < 1_000_000) {
      const v = n / 1_000
      return `${v >= 10 ? v.toFixed(0) : v.toFixed(1)}k`
    }
    const v = n / 1_000_000
    return `${v >= 10 ? v.toFixed(0) : v.toFixed(1)}m`
  }

  export function formatPct(value: number, total: number): string {
    if (total <= 0) return "—"
    const pct = (value / total) * 100
    if (pct >= 10) return `${pct.toFixed(0)}%`
    return `${pct.toFixed(1)}%`
  }
}
