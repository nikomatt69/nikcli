import type { ProviderCatalog, ProviderModel } from "@/lib/types"

export type MobileModelOption = {
  id: string
  providerID: string
  modelID: string
  title: string
  shortName: string
  badge?: string
  reasoning: boolean
  variants: string[]
}

export function modelKey(providerID: string, modelID: string): string {
  return `${providerID}/${modelID}`
}

export function parseModelKey(key: string): { providerID: string; modelID: string } | null {
  const slash = key.indexOf("/")
  if (slash <= 0) return null
  return { providerID: key.slice(0, slash), modelID: key.slice(slash + 1) }
}

export function isVariantDisabled(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    "disabled" in value &&
    (value as { disabled?: boolean }).disabled === true
  )
}

export function listEnabledVariants(variants?: Record<string, unknown>): string[] {
  if (!variants) return []
  const order = ["none", "minimal", "low", "medium", "high", "xhigh", "max"]
  return Object.entries(variants)
    .filter(([, value]) => !isVariantDisabled(value))
    .map(([key]) => key)
    .sort((a, b) => {
      const ai = order.indexOf(a)
      const bi = order.indexOf(b)
      if (ai === -1 && bi === -1) return a.localeCompare(b)
      if (ai === -1) return 1
      if (bi === -1) return -1
      return ai - bi
    })
}

export function formatVariantLabel(variant: string): string {
  if (variant === "xhigh") return "Extra high"
  return variant
    .split(/[_-]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

export function modelSupportsThinking(model: Pick<ProviderModel, "id" | "variants">): boolean {
  return model.id.endsWith(":thinking") || listEnabledVariants(model.variants).length > 0
}

export function buildModelCatalog(
  catalog: ProviderCatalog,
  options?: { connectedOnly?: boolean },
): MobileModelOption[] {
  const connected = new Set(catalog.connected)
  return catalog.all
    .filter((provider) => !options?.connectedOnly || connected.has(provider.id))
    .flatMap((provider) =>
      Object.values(provider.models)
        .filter((model) => model.status !== "deprecated")
        .map((model) => {
          const variants = listEnabledVariants(model.variants)
          const reasoning = modelSupportsThinking(model)
          return {
            id: modelKey(provider.id, model.id),
            providerID: provider.id,
            modelID: model.id,
            title: `${provider.name} — ${model.name}`,
            shortName: model.name,
            badge:
              model.id === catalog.default[provider.id]
                ? "Default"
                : model.id.endsWith(":thinking")
                  ? "Thinking"
                  : reasoning && variants.length > 0
                    ? "Reasoning"
                    : undefined,
            reasoning,
            variants,
          }
        }),
    )
    .sort((a, b) => a.title.localeCompare(b.title))
}

export function findModelOption(
  catalog: MobileModelOption[],
  providerID: string,
  modelID: string,
): MobileModelOption | undefined {
  return catalog.find((item) => item.providerID === providerID && item.modelID === modelID)
}
