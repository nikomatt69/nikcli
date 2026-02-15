import { createMemo, createSignal, createResource } from "solid-js"
import { useSync } from "@tui/context/sync"
import { entries, sortBy } from "remeda"
import { DialogSelect, type DialogSelectRef } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import { useSDK } from "@tui/context/sdk"
import { useToast } from "@tui/ui/toast"
import { DialogProvider } from "./dialog-provider"

interface RagConfig {
  model?: string
  provider?: string
}

interface ConfigWithRag {
  rag?: RagConfig
}

interface OpenRouterEmbeddingModel {
  id: string
  name?: string
  context_length?: number
}

function isEmbeddingModel(providerID: string, modelID: string, info: any): boolean {
  const id = modelID.toLowerCase()
  const name = String(info?.name ?? "").toLowerCase()

  // Ollama frequently uses embedding models without an "embed" substring (e.g. all-minilm).
  if (providerID === "ollama") {
    if (id.includes("embed") || id.includes("embedding")) return true
    if (id.includes("minilm")) return true
    if (id.startsWith("e5") || id.includes("/e5") || id.includes("e5-")) return true
    if (id.includes("bge")) return true
    if (id.includes("gte")) return true
    if (id.includes("arctic-embed")) return true
    return name.includes("embed") || name.includes("embedding")
  }

  return (
    id.includes("embedding") ||
    id.includes("embed") ||
    name.includes("embedding") ||
    name.includes("embed") ||
    id.includes("text-embedding") ||
    name.includes("text-embedding")
  )
}

async function fetchOpenRouterEmbeddingModels(apiKey: string): Promise<OpenRouterEmbeddingModel[]> {
  try {
    const response = await fetch("https://openrouter.ai/api/v1/embeddings/models", {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    })
    if (!response.ok) return []
    const data = await response.json()
    return data.data ?? []
  } catch {
    return []
  }
}

export function DialogRagModel() {
  const sync = useSync()
  const dialog = useDialog()
  const sdk = useSDK()
  const toast = useToast()
  const [ref, setRef] = createSignal<DialogSelectRef<{ providerID: string; modelID: string }>>()
  const [query, setQuery] = createSignal("")

  const currentRag = createMemo(() => (sync.data.config as ConfigWithRag | undefined)?.rag)
  // Prefer provider_next.connected but also include config.providers list as fallback.
  const connectedProviderIDs = createMemo(() => {
    const ids = new Set<string>()
    for (const id of sync.data.provider_next.connected ?? []) ids.add(id)
    for (const p of sync.data.provider ?? []) ids.add((p as any).id)
    return ids
  })

  const openRouterKey = createMemo(() => {
    if (!connectedProviderIDs().has("openrouter")) return undefined
    const p = (sync.data.provider ?? []).find((x) => (x as any).id === "openrouter") as any
    return (p?.key as string | undefined) ?? (p?.options?.apiKey as string | undefined)
  })

  const [openRouterModels] = createResource(openRouterKey, async (key) => {
    if (!key) return [] as OpenRouterEmbeddingModel[]
    return fetchOpenRouterEmbeddingModels(key)
  })

  const options = createMemo(() => {
    const needle = query().trim().toLowerCase()
    const connected = connectedProviderIDs()

    const allOptions: Array<{
      value: { providerID: string; modelID: string }
      title: string
      description: string
      category?: string
      disabled?: boolean
      onSelect: () => void
    }> = []

    for (const provider of sync.data.provider_next.all as any[]) {
      if (!connected.has(provider.id)) continue
      for (const [model, info] of entries(provider.models)) {
        if (!isEmbeddingModel(provider.id, model, info)) continue
        if (info.status === "deprecated") continue

        const value = { providerID: provider.id, modelID: model }
        const isCurrent = provider.id === currentRag()?.provider && model === currentRag()?.model

        allOptions.push({
          value,
          title: info.name ?? model,
          description: provider.name,
          category: provider.name,
          disabled: isCurrent,
          onSelect: async () => {
            const { error } = await sdk.client.config.update({
              config: { rag: { provider: provider.id, model: model } } as any,
            })
            if (error) {
              toast.show({ message: "Failed to update RAG config", variant: "error" })
              return
            }
            toast.show({ message: "RAG model updated", variant: "success" })
            dialog.clear()
          },
        })
      }
    }

    const sorted = sortBy(allOptions, (x) => x.title)
    if (sorted.length === 0) {
      if (connected.size === 0) {
        return [
          {
            value: { providerID: "__help__", modelID: "__connect__" },
            title: "No providers connected",
            description: "Run /connect to add a provider, then retry.",
            category: "Help",
            onSelect: () => {
              dialog.replace(() => <DialogProvider />)
            },
          },
          {
            value: { providerID: "__help__", modelID: "__retry__" },
            title: "Retry provider scan",
            description: "Refresh providers and models list",
            category: "Help",
            onSelect: async () => {
              await sdk.client.instance.dispose()
              await sync.bootstrap()
              toast.show({ message: "Providers refreshed", variant: "info" })
            },
          },
        ] as any
      }

      return [
        {
          value: { providerID: "__help__", modelID: "__none__" },
          title: "No embedding models found",
          description: "Connected providers did not expose embedding models",
          category: "Help",
          onSelect: () => {},
        },
      ] as any
    }

    // If OpenRouter is connected, augment with embedding models fetched from OpenRouter API.
    // This helps when models.dev metadata is incomplete/outdated.
    if (connected.has("openrouter")) {
      const existing = new Set(sorted.filter((x) => x.value.providerID === "openrouter").map((x) => x.value.modelID))
      for (const model of openRouterModels() ?? []) {
        if (!model?.id) continue
        if (existing.has(model.id)) continue
        const value = { providerID: "openrouter", modelID: model.id }
        const isCurrent = currentRag()?.provider === "openrouter" && currentRag()?.model === model.id
        sorted.push({
          value,
          title: model.name ?? model.id,
          description: model.context_length ? `${Math.round(model.context_length / 1000)}k ctx` : "OpenRouter",
          category: "OpenRouter",
          disabled: isCurrent,
          onSelect: async () => {
            const { error } = await sdk.client.config.update({
              config: { rag: { provider: "openrouter", model: model.id } } as any,
            })
            if (error) {
              toast.show({ message: "Failed to update RAG config", variant: "error" })
              return
            }
            toast.show({ message: "RAG model updated", variant: "success" })
            dialog.clear()
          },
        })
      }
    }

    if (!needle) return sorted
    return sorted.filter((x) => x.title.toLowerCase().includes(needle))
  })

  return (
    <DialogSelect
      ref={(r) => setRef(r as any)}
      onFilter={setQuery}
      skipFilter={true}
      title="Select RAG embedding model"
      options={options() as any}
    />
  )
}
