import { createMemo, createSignal, createEffect } from "solid-js"
import { useSync } from "@tui/context/sync"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import { useSDK } from "@tui/context/sdk"
import { useToast } from "@tui/ui/toast"
import { ttsRegistry, type TTSProvider, type TTSVoice } from "@/tool/speak/provider"
import { ELEVENLABS_VOICES_LIST, elevenLabsProvider } from "@/tool/speak/elevenlabs"
import { OPENROUTER_VOICES_LIST, openRouterProvider } from "@/tool/speak/openrouter"

// Register providers
ttsRegistry.register(elevenLabsProvider)
ttsRegistry.register(openRouterProvider)

interface SpeakConfig {
  model?: string
  modelId?: string
  provider?: string
}

interface ConfigWithSpeak {
  speak?: SpeakConfig
}

const VOICES_BY_PROVIDER: Record<string, TTSVoice[]> = {
  elevenlabs: ELEVENLABS_VOICES_LIST,
  openrouter: OPENROUTER_VOICES_LIST,
}

type SelectionMode = "provider" | "voice"
const DEFAULT_OPENROUTER_VOICE = "alloy"
const DEFAULT_OPENROUTER_MODEL_ID = "openai/gpt-audio-mini"
const OPENROUTER_VOICE_IDS = new Set(OPENROUTER_VOICES_LIST.map((voice) => voice.id))

function resolveOpenRouterVoice(voice: string | undefined): string {
  if (!voice) return DEFAULT_OPENROUTER_VOICE
  return OPENROUTER_VOICE_IDS.has(voice) ? voice : DEFAULT_OPENROUTER_VOICE
}

interface ProviderInfo {
  id: string
  name: string
  description: string
}

export function DialogSpeakModel() {
  const sync = useSync()
  const dialog = useDialog()
  const sdk = useSDK()
  const toast = useToast()

  const [mode, setMode] = createSignal<SelectionMode>("provider")
  const [selectedProvider, setSelectedProvider] = createSignal<string>("elevenlabs")
  const [query, setQuery] = createSignal("")
  const [saving, setSaving] = createSignal(false)
  const [openRouterModels, setOpenRouterModels] = createSignal<Array<{ id: string; name: string }>>([])
  const [openRouterModelsLoading, setOpenRouterModelsLoading] = createSignal(false)

  const currentSpeak = createMemo(() => (sync.data.config as ConfigWithSpeak | undefined)?.speak)
  const isLoading = createMemo(() => sync.status === "loading" || sync.status === "partial")

  // Initialize from current config
  createEffect(() => {
    const current = currentSpeak()
    if (current?.provider) {
      setSelectedProvider(current.provider)
    }
  })

  createEffect(() => {
    if (selectedProvider() !== "openrouter") return

    let cancelled = false
    setOpenRouterModelsLoading(true)

    openRouterProvider
      .getAudioModels({ refresh: true })
      .then((models) => {
        if (cancelled) return
        setOpenRouterModels(models)
      })
      .catch(() => {
        if (cancelled) return
        setOpenRouterModels([])
        toast.show({ message: "Failed to load OpenRouter audio models", variant: "error" })
      })
      .finally(() => {
        if (cancelled) return
        setOpenRouterModelsLoading(false)
      })

    return () => {
      cancelled = true
    }
  })

  // Get list of providers
  const providers = createMemo((): ProviderInfo[] => {
    return ttsRegistry.list().map((provider: TTSProvider) => ({
      id: provider.id,
      name: provider.name,
      description: provider.description,
    }))
  })

  // Get voices for selected provider
  const voices = createMemo((): TTSVoice[] => {
    const providerId = selectedProvider()
    return VOICES_BY_PROVIDER[providerId] ?? []
  })

  // Options for provider selection
  const providerOptions = createMemo(() => {
    const needle = query().trim().toLowerCase()

    const allOptions = providers().map((provider: ProviderInfo) => ({
      value: provider.id,
      title: provider.name,
      description: provider.description,
      category: "Provider",
      disabled: false,
      onSelect: () => {
        if (saving()) return
        setSelectedProvider(provider.id)
        setMode("voice")
        setQuery("")
      },
    }))

    // Add help options if config hasn't been loaded yet
    if (isLoading() || !sync.data.config) {
      allOptions.unshift({
        value: "__loading__",
        title: "Loading configuration...",
        description: "Please wait while the config loads",
        category: "Help",
        disabled: true,
        onSelect: () => {},
      })
    }

    if (!needle) return allOptions
    return allOptions.filter(
      (x: any) => x.title.toLowerCase().includes(needle) || x.description.toLowerCase().includes(needle),
    )
  })

  // Options for voice selection
  const voiceOptions = createMemo(() => {
    const needle = query().trim().toLowerCase()
    const current = currentSpeak()
    const providerId = selectedProvider()

    if (providerId === "openrouter") {
      const models = openRouterModels()
      const allModelOptions: any[] = models.map((model) => ({
        value: { providerId, modelId: model.id },
        title: model.name,
        description: model.id,
        category: "Model",
        disabled: current?.provider === providerId && current?.modelId === model.id,
        onSelect: async () => {
          if (saving()) return
          setSaving(true)
          try {
            const { error } = await sdk.client.config.update({
              config: {
                speak: {
                  provider: providerId,
                  model: resolveOpenRouterVoice(current?.model),
                  modelId: model.id,
                },
              } as any,
            })
            if (error) {
              toast.show({ message: "Failed to update speak config", variant: "error" })
              return
            }
            toast.show({ message: "OpenRouter audio model updated", variant: "success" })
            dialog.clear()
          } catch {
            toast.show({ message: "Failed to update speak config", variant: "error" })
          } finally {
            setSaving(false)
          }
        },
      }))

      if (openRouterModelsLoading() && allModelOptions.length === 0) {
        allModelOptions.unshift({
          value: "__loading_models__",
          title: "Loading OpenRouter models...",
          description: "Fetching audio-capable models from OpenRouter API",
          category: "Help",
          disabled: true,
          onSelect: async () => {},
        })
      }

      if (!openRouterModelsLoading() && allModelOptions.length === 0) {
        allModelOptions.unshift({
          value: "__default_model__",
          title: DEFAULT_OPENROUTER_MODEL_ID,
          description: "Default OpenRouter audio model",
          category: "Model",
          disabled:
            current?.provider === providerId &&
            (current?.modelId ?? DEFAULT_OPENROUTER_MODEL_ID) === DEFAULT_OPENROUTER_MODEL_ID,
          onSelect: async () => {
            if (saving()) return
            setSaving(true)
            try {
              const { error } = await sdk.client.config.update({
                config: {
                  speak: {
                    provider: providerId,
                    model: resolveOpenRouterVoice(current?.model),
                    modelId: DEFAULT_OPENROUTER_MODEL_ID,
                  },
                } as any,
              })
              if (error) {
                toast.show({ message: "Failed to update speak config", variant: "error" })
                return
              }
              toast.show({ message: "OpenRouter audio model updated", variant: "success" })
              dialog.clear()
            } catch {
              toast.show({ message: "Failed to update speak config", variant: "error" })
            } finally {
              setSaving(false)
            }
          },
        })
      }

      if (!needle) return allModelOptions
      return allModelOptions.filter(
        (x: any) => x.title.toLowerCase().includes(needle) || x.description.toLowerCase().includes(needle),
      )
    }

    const allOptions = voices().map((voice: TTSVoice) => ({
      value: { providerId, voiceId: voice.id },
      title: voice.name,
      description: voice.id,
      category: providerId,
      disabled: current?.provider === providerId && current?.model === voice.id,
      onSelect: async () => {
        if (saving()) return
        setSaving(true)
        try {
          const { error } = await sdk.client.config.update({
            config: { speak: { provider: providerId, model: voice.id } } as any,
          })
          if (error) {
            toast.show({ message: "Failed to update speak config", variant: "error" })
            return
          }
          toast.show({ message: "Speak model updated", variant: "success" })
          dialog.clear()
        } catch (e) {
          toast.show({ message: "Failed to update speak config", variant: "error" })
        } finally {
          setSaving(false)
        }
      },
    }))

    if (!needle) return allOptions
    return allOptions.filter(
      (x: any) => x.title.toLowerCase().includes(needle) || x.description.toLowerCase().includes(needle),
    )
  })

  const options = createMemo(() => {
    return mode() === "provider" ? providerOptions() : voiceOptions()
  })

  const title = createMemo(() => {
    if (saving()) {
      return "Saving..."
    }
    if (mode() === "provider") {
      return "Select TTS Provider"
    }
    const providerName = providers().find((p: ProviderInfo) => p.id === selectedProvider())?.name ?? selectedProvider()
    if (selectedProvider() === "openrouter") {
      return `Select Audio Model (${providerName})`
    }
    return `Select Voice (${providerName})`
  })

  // Transform options for DialogSelect
  const transformedOptions = createMemo(() => {
    const opts = options()
    return opts.map((opt: any) => ({
      ...opt,
      category: opt.category,
    }))
  })

  return <DialogSelect onFilter={setQuery} skipFilter={true} title={title()} options={transformedOptions() as any} />
}
