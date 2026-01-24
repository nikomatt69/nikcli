import { createMemo, createSignal } from "solid-js"
import { useSync } from "@tui/context/sync"
import { pipe, flatMap, entries, filter, sortBy } from "remeda"
import { DialogSelect, type DialogSelectRef } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import { useSDK } from "@tui/context/sdk"
import { useToast } from "@tui/ui/toast"

interface RagConfig {
  model?: string
  provider?: string
}

interface ConfigWithRag {
  rag?: RagConfig
}

export function DialogRagModel() {
  const sync = useSync()
  const dialog = useDialog()
  const sdk = useSDK()
  const toast = useToast()
  const [ref, setRef] = createSignal<DialogSelectRef<{ providerID: string; modelID: string }>>()
  const [query, setQuery] = createSignal("")

  const currentRag = createMemo(() => (sync.data.config as ConfigWithRag | undefined)?.rag)

  const options = createMemo(() => {
    const q = query()
    const needle = q.trim()

    const allOptions: Array<{
      value: { providerID: string; modelID: string }
      title: string
      description: string
      category?: string
      disabled?: boolean
      onSelect: () => void
    }> = []

    for (const provider of sync.data.provider) {
      for (const [model, info] of entries(provider.models)) {
        if (!model.includes("embed") && !model.includes("embedding")) continue
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

    if (!needle) return sorted

    return sorted.filter((x) => x.title.toLowerCase().includes(needle.toLowerCase()))
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
