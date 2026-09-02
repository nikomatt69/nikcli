import type {
  SessionConfigOption,
  SessionConfigSelect,
  SessionConfigSelectGroup,
  SessionConfigSelectOption,
  SessionConfigSelectOptions,
} from "@agentclientprotocol/sdk"

/**
 * Builders that turn nikcli's provider / model / mode metadata into the
 * ACP `SessionConfigOption[]` payload surfaced on `NewSessionResponse`,
 * `LoadSessionResponse`, and `SetSessionConfigOptionResponse`.
 *
 * The shapes mirror opencode's `config-option.ts` so the wire-level
 * semantics (current value, ordered options, model variant selector) are
 * identical for any client that already speaks opencode.
 */

/**
 * Sentinel for the "default" variant. We emit a hidden option labelled
 * "Default" for it so the protocol still allows the agent to pick
 * "default" while clients can render the variant as the chosen one.
 */
export const DEFAULT_VARIANT_VALUE = "default"

/**
 * Minimal provider projection used by the option builders. Accepts both
 * `Provider.Info` and the loose JSON shape returned by `config.providers`.
 */
export type ConfigOptionProvider = {
  readonly id: string
  readonly name: string
  readonly models: Record<
    string,
    {
      readonly id: string
      readonly name: string
      readonly variants?: Record<string, Record<string, unknown>>
    }
  >
}

export type ConfigOptionMode = {
  readonly id: string
  readonly name: string
  readonly description?: string
}

export type ModelSelection = {
  readonly model: {
    readonly providerID: string
    readonly modelID: string
  }
  readonly variant?: string
}

/**
 * Build the `model` selector option. When `includeVariants` is true,
 * each model expands into multiple options — one per variant — so clients
 * can render effort levels as part of the same dropdown.
 */
export function buildModelSelectOption(input: {
  readonly providers: ReadonlyArray<ConfigOptionProvider>
  readonly currentModel: ModelSelection["model"]
  readonly currentVariant?: string
  readonly includeVariants?: boolean
}): SessionConfigOption {
  return {
    id: "model",
    name: "Model",
    category: "model",
    type: "select",
    currentValue: formatCurrentModelId({
      model: input.currentModel,
      variant: input.currentVariant,
      variants: variantsForModel(input.providers, input.currentModel),
      includeVariant: input.includeVariants ?? false,
    }),
    options: buildModelSelectOptions(input.providers, {
      includeVariants: input.includeVariants ?? false,
    }),
  }
}

/**
 * Build the `effort` selector for a given model. Returns `undefined` when
 * the current model has no variants so callers can omit it cleanly from
 * the response array.
 */
export function buildEffortSelectOption(input: {
  readonly variants: ReadonlyArray<string>
  readonly currentVariant?: string
}): SessionConfigOption | undefined {
  if (input.variants.length === 0) return undefined

  return {
    id: "effort",
    name: "Effort",
    description: "Available effort levels for this model",
    category: "thought_level",
    type: "select",
    currentValue: selectVariant(input.currentVariant, input.variants),
    options: input.variants.map((variant) => ({
      value: variant,
      name: formatVariantName(variant),
    })),
  }
}

/**
 * Build the `mode` selector from a flat list of agent definitions. The
 * nikcli service layer pre-filters this list to user-visible primary
 * agents before passing it in.
 */
export function buildModeSelectOption(input: {
  readonly modes: ReadonlyArray<ConfigOptionMode>
  readonly currentModeId: string
}): SessionConfigOption {
  return {
    id: "mode",
    name: "Session Mode",
    category: "mode",
    type: "select",
    currentValue: input.currentModeId,
    options: input.modes.map((mode) => ({
      value: mode.id,
      name: mode.name,
      ...(mode.description ? { description: mode.description } : undefined),
    })),
  }
}

/**
 * Compose the canonical three-option payload (model + effort + mode) in
 * the order the ACP clients expect. Modes are only included when the
 * session has a meaningful `currentModeId`.
 */
export function buildConfigOptions(input: {
  readonly providers: ReadonlyArray<ConfigOptionProvider>
  readonly currentModel: ModelSelection["model"]
  readonly currentVariant?: string
  readonly includeModelVariants?: boolean
  readonly modes?: ReadonlyArray<ConfigOptionMode>
  readonly currentModeId?: string
}): SessionConfigOption[] {
  const variants = variantsForModel(input.providers, input.currentModel)
  const effort = buildEffortSelectOption({
    variants,
    currentVariant: input.currentVariant,
  })

  return [
    buildModelSelectOption({
      providers: input.providers,
      currentModel: input.currentModel,
      currentVariant: input.currentVariant,
      includeVariants: input.includeModelVariants ?? false,
    }),
    ...(effort ? [effort] : []),
    ...(input.modes && input.currentModeId
      ? [
          buildModeSelectOption({
            modes: input.modes,
            currentModeId: input.currentModeId,
          }),
        ]
      : []),
  ]
}

/**
 * Parse a `modelId` string from an ACP `SetSessionModelRequest` or the
 * `value` field of a `SetSessionConfigOptionRequest` into the structured
 * `{ providerID, modelID, variant }` triple. Supports three encodings:
 *
 * - `provider/model` — provider + model id
 * - `provider/model/variant` — provider + model + variant
 * - Anything else — best-effort split on the first `/`
 */
export function parseModelSelection(modelId: string, providers: ReadonlyArray<ConfigOptionProvider>): ModelSelection {
  const provider = providers.find((item) => modelId.startsWith(`${item.id}/`))
  if (provider) {
    const modelID = modelId.slice(provider.id.length + 1)
    if (provider.models[modelID]) {
      return { model: { providerID: provider.id, modelID } }
    }

    const separator = modelID.lastIndexOf("/")
    if (separator > -1) {
      const baseModelID = modelID.slice(0, separator)
      const variant = modelID.slice(separator + 1)
      if (provider.models[baseModelID]?.variants?.[variant]) {
        return {
          model: { providerID: provider.id, modelID: baseModelID },
          variant,
        }
      }
    }

    return { model: { providerID: provider.id, modelID } }
  }

  const separator = modelId.indexOf("/")
  if (separator === -1) {
    return { model: { providerID: modelId, modelID: "" } }
  }

  return {
    model: {
      providerID: modelId.slice(0, separator),
      modelID: modelId.slice(separator + 1),
    },
  }
}

/**
 * Render the `currentValue` for the `model` selector. Encodes the variant
 * suffix only when the variant selector is exposed so the wire value
 * matches the options the client can see.
 */
export function formatCurrentModelId(input: {
  readonly model: ModelSelection["model"]
  readonly variant?: string
  readonly variants?: ReadonlyArray<string>
  readonly includeVariant?: boolean
}): string {
  const base = `${input.model.providerID}/${input.model.modelID}`
  if (!input.includeVariant || !input.variants?.length) return base
  return `${base}/${selectVariant(input.variant, input.variants)}`
}

/**
 * Turn snake_case / kebab-case variant names into title-cased display
 * labels. Examples:
 * - `low` → `Low`
 * - `high_effort` → `High Effort`
 */
export function formatVariantName(variant: string): string {
  return variant
    .split(/[_-]/)
    .map((part) => (part ? part.charAt(0).toUpperCase() + part.slice(1) : part))
    .join(" ")
}

/**
 * Stable stringification for option keys. Mirrors opencode's helper so the
 * same model selection always produces the same wire value (important when
 * caching MCP server registrations).
 */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`
  if (!value || typeof value !== "object") return JSON.stringify(value)
  return `{${Object.entries(value as Record<string, unknown>)
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
    .join(",")}}`
}

function buildModelSelectOptions(
  providers: ReadonlyArray<ConfigOptionProvider>,
  options: { includeVariants: boolean },
): SessionConfigSelectOptions {
  const flat: SessionConfigSelectOption[] = []
  const groups: SessionConfigSelectGroup[] = []

  for (const provider of providers) {
    const sortedModels = Object.values(provider.models).sort((a, b) => a.name.localeCompare(b.name))
    const providerOptions: SessionConfigSelectOption[] = []

    for (const model of sortedModels) {
      const base: SessionConfigSelectOption = {
        value: `${provider.id}/${model.id}`,
        name: `${provider.name}/${model.name}`,
      }
      providerOptions.push(base)
      if (!options.includeVariants || !model.variants) continue

      for (const variant of Object.keys(model.variants)) {
        if (variant === DEFAULT_VARIANT_VALUE) continue
        providerOptions.push({
          value: `${provider.id}/${model.id}/${variant}`,
          name: `${provider.name}/${model.name} (${formatVariantName(variant)})`,
        })
      }
    }

    if (providerOptions.length > 1) {
      // Wrap multiple options in a group so clients render the provider
      // hierarchy rather than a flat alphabetical list.
      groups.push({
        group: provider.id,
        name: provider.name,
        options: providerOptions,
      })
    } else if (providerOptions.length === 1) {
      flat.push(providerOptions[0])
    }
  }

  return groups.length > 0 ? groups : flat
}

function variantsForModel(providers: ReadonlyArray<ConfigOptionProvider>, model: ModelSelection["model"]): string[] {
  return Object.keys(
    providers.find((provider) => provider.id === model.providerID)?.models[model.modelID]?.variants ?? {},
  )
}

/**
 * Pick the variant reported as the current value. Falls back to the
 * `default` variant when present (so clients render it as the chosen one
 * even though we filter it from the option list), then to the first
 * available variant as a last resort.
 */
function selectVariant(variant: string | undefined, variants: ReadonlyArray<string>): string {
  if (variant && variants.includes(variant)) return variant
  if (variants.includes(DEFAULT_VARIANT_VALUE)) return DEFAULT_VARIANT_VALUE
  return variants[0]
}

// Re-export the SDK select shape so consumers can build their own options
// without reaching into the SDK.
export type { SessionConfigSelect }

export * as ACPConfigOption from "./config-option"
