import { createMemo, createSignal } from "solid-js"
import { useSync } from "@tui/context/sync"
import { entries, sortBy } from "remeda"
import { DialogSelect, type DialogSelectRef } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import { useSDK } from "@tui/context/sdk"
import { useToast } from "@tui/ui/toast"

interface ImageConfig {
  model?: string
  provider?: string
}

interface ConfigWithImage {
  image?: ImageConfig
}

function isImageModel(modelID: string, info: any): boolean {
  // Primary signal from models.dev -> Provider.Model.capabilities.output.image
  if (info?.capabilities?.output?.image === true) return true

  // Fallback heuristics for models missing modalities metadata.
  const id = modelID.toLowerCase()
  if (id.includes("dall-e")) return true
  if (id.includes("gpt-image")) return true
  if (id.includes("-image") || id.includes("image-")) return true
  return false
}

export function DialogImageModel() {
  const sync = useSync()
  const dialog = useDialog()
  const sdk = useSDK()
  const toast = useToast()
  const [ref, setRef] = createSignal<DialogSelectRef<{ providerID: string; modelID: string }>>()
  const [query, setQuery] = createSignal("")

  const currentImage = createMemo(() => (sync.data.config as ConfigWithImage | undefined)?.image)

  const connectedProviderIDs = createMemo(() => new Set(sync.data.provider_next.connected ?? []))

  const options = createMemo(() => {
    const needle = query().trim().toLowerCase()
    const allOptions: Array<{
      value: { providerID: string; modelID: string }
      title: string
      description: string
      category?: string
      disabled?: boolean
      onSelect: () => void
    }> = []

    for (const provider of sync.data.provider_next.all as any[]) {
      if (!connectedProviderIDs().has(provider.id)) continue
      for (const [modelID, info] of entries(provider.models)) {
        if (info.status === "deprecated") continue
        if (!isImageModel(modelID, info)) continue

        const value = { providerID: provider.id, modelID }
        const isCurrent = provider.id === currentImage()?.provider && modelID === currentImage()?.model

        allOptions.push({
          value,
          title: info.name ?? modelID,
          description: provider.name,
          category: provider.name,
          disabled: isCurrent,
          onSelect: async () => {
            const { error } = await sdk.client.config.update({
              config: { image: { provider: provider.id, model: modelID } } as any,
            })
            if (error) {
              toast.show({ message: "Failed to update image config", variant: "error" })
              return
            }
            toast.show({ message: "Image model updated", variant: "success" })
            dialog.clear()
          },
        })
      }
    }

    const sorted = sortBy(allOptions, (x) => x.title)
    if (!needle) return sorted
    return sorted.filter((x) => x.title.toLowerCase().includes(needle))
  })

  return (
    <DialogSelect
      ref={(r) => setRef(r as any)}
      onFilter={setQuery}
      skipFilter={true}
      title="Select image generation model"
      options={options() as any}
    />
  )
}
