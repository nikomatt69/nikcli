import type { TTSProvider, TTSProviderConfig, TTSRequest, TTSResponse, TTSVoice } from "./provider"

const OPENROUTER_VOICES: TTSVoice[] = [
  { id: "alloy", name: "Alloy" },
  { id: "ash", name: "Ash" },
  { id: "ballad", name: "Ballad" },
  { id: "coral", name: "Coral" },
  { id: "echo", name: "Echo" },
  { id: "fable", name: "Fable" },
  { id: "nova", name: "Nova" },
  { id: "onyx", name: "Onyx" },
  { id: "sage", name: "Sage" },
  { id: "shimmer", name: "Shimmer" },
]

const DEFAULT_MODEL_ID = "openai/gpt-audio-mini"
const DEFAULT_OUTPUT_FORMAT = "mp3"
const BASE_URL = "https://openrouter.ai/api/v1"

type OpenRouterErrorBody = {
  error?: {
    message?: string
  }
  message?: string
  detail?: string
}

type OpenRouterModelListResponse = {
  data?: Array<{
    id?: string
    name?: string
    architecture?: {
      input_modalities?: string[]
      output_modalities?: string[]
    }
  }>
}

function normalizeOutputFormat(format: string): string {
  const value = format.toLowerCase()
  if (value.startsWith("wav")) return "wav"
  if (value.startsWith("flac")) return "flac"
  if (value.startsWith("opus")) return "opus"
  if (value.startsWith("pcm")) return "pcm"
  if (value.startsWith("aac")) return "aac"
  return "mp3"
}

export class OpenRouterProvider implements TTSProvider {
  readonly id = "openrouter"
  readonly name = "OpenRouter"
  readonly description = "OpenRouter OpenAI-compatible text-to-speech"

  private config: TTSProviderConfig | null = null
  private audioModelsCache: { at: number; models: TTSVoice[] } | null = null

  async getConfig(): Promise<TTSProviderConfig> {
    if (this.config) return this.config

    const { Config } = await import("@/config/config")
    const { Auth } = await import("@/auth")

    const auth = await Auth.get("openrouter")
    const config = await Config.get().catch(() => Config.getGlobal().catch(() => ({} as any)))

    const providerOptions = config?.provider?.openrouter?.options ?? {}
    const fromProviderOptions = typeof providerOptions.apiKey === "string" ? providerOptions.apiKey : undefined
    const apiKey =
      process.env.NIKCLI_OPENROUTER_API_KEY ??
      process.env.OPENROUTER_API_KEY ??
      (auth?.type === "api" ? auth.key : undefined) ??
      fromProviderOptions

    if (!apiKey || !apiKey.trim()) {
      throw new Error(
        [
          "OpenRouter API key not found.",
          "",
          "Set NIKCLI_OPENROUTER_API_KEY (or OPENROUTER_API_KEY),",
          "or run `nikcli auth login` and choose openrouter.",
        ].join("\n"),
      )
    }

    this.config = {
      apiKey: apiKey.trim(),
      baseURL:
        process.env.NIKCLI_OPENROUTER_BASE_URL ??
        (typeof providerOptions.baseURL === "string" ? providerOptions.baseURL : BASE_URL),
      timeout: 30000,
    }
    return this.config
  }

  async getVoices(): Promise<TTSVoice[]> {
    return OPENROUTER_VOICES
  }

  async getAudioModels(options?: { refresh?: boolean }): Promise<TTSVoice[]> {
    const refresh = options?.refresh ?? false
    const now = Date.now()
    if (!refresh && this.audioModelsCache && now - this.audioModelsCache.at < 5 * 60_000) {
      return this.audioModelsCache.models
    }

    const baseURL = process.env.NIKCLI_OPENROUTER_BASE_URL ?? BASE_URL
    const response = await fetch(`${baseURL}/models`)
    if (!response.ok) {
      throw new Error(`OpenRouter model listing failed (${response.status})`)
    }

    const payload = (await response.json()) as OpenRouterModelListResponse
    const models = (payload.data ?? [])
      .filter((model) => {
        const output = model.architecture?.output_modalities ?? []
        const input = model.architecture?.input_modalities ?? []
        if (!model.id) return false
        if (!output.includes("audio")) return false
        if (input.length > 0 && !input.includes("text")) return false
        return true
      })
      .map((model) => ({
        id: model.id!,
        name: model.name?.trim() || model.id!,
      }))
      .sort((a, b) => a.name.localeCompare(b.name))

    const result = models.length
      ? models
      : [
          {
            id: DEFAULT_MODEL_ID,
            name: DEFAULT_MODEL_ID,
          },
        ]

    this.audioModelsCache = { at: now, models: result }
    return result
  }

  async speak(request: TTSRequest, options?: { signal?: AbortSignal }): Promise<TTSResponse> {
    const config = await this.getConfig()
    const modelId = request.modelId ?? DEFAULT_MODEL_ID
    const voiceId = request.voiceId || "alloy"
    const outputFormat = normalizeOutputFormat(request.outputFormat ?? DEFAULT_OUTPUT_FORMAT)
    const speed = request.speed ?? 1.0

    const response = await fetch(`${config.baseURL}/audio/speech`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://nikcli.store/",
        "X-Title": "nikcli",
      },
      body: JSON.stringify({
        model: modelId,
        input: request.text,
        voice: voiceId,
        response_format: outputFormat,
        format: outputFormat,
        speed,
      }),
      signal: options?.signal,
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => "")
      let errorDetail = errorText

      try {
        const parsed = JSON.parse(errorText) as OpenRouterErrorBody
        errorDetail = parsed.error?.message ?? parsed.message ?? parsed.detail ?? errorText
      } catch {
        // keep raw text
      }

      switch (response.status) {
        case 401:
          throw new Error("OpenRouter authentication failed (401). Your API key may be invalid or expired.")
        case 429:
          throw new Error("OpenRouter rate limit exceeded (429). Too many requests.")
        case 400:
          throw new Error(`OpenRouter bad request (400): ${errorDetail}`)
        default:
          throw new Error(`OpenRouter error (${response.status}): ${errorDetail}`)
      }
    }

    const audioBuffer = await response.arrayBuffer()
    const contentType = response.headers.get("content-type") ?? outputFormat

    return {
      audio: audioBuffer,
      contentType,
      metadata: {
        provider: this.id,
        modelId,
        voiceId,
      },
    }
  }

  async validate(): Promise<{ valid: boolean; error?: string }> {
    try {
      const config = await this.getConfig()
      const response = await fetch(`${config.baseURL}/models`, {
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
        },
      })

      if (response.status === 401) {
        return { valid: false, error: "Invalid API key" }
      }

      if (!response.ok) {
        return { valid: false, error: `API returned status ${response.status}` }
      }

      return { valid: true }
    } catch (error) {
      return { valid: false, error: error instanceof Error ? error.message : "Unknown error" }
    }
  }
}

export const openRouterProvider = new OpenRouterProvider()
export const OPENROUTER_VOICES_LIST = OPENROUTER_VOICES
