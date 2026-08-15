/**
 * ElevenLabs TTS Provider Implementation
 */

import path from "path"
import type { TTSProvider, TTSVoice, TTSRequest, TTSResponse, TTSProviderConfig } from "./provider"
import { Global } from "../global"

const ELEVENLABS_VOICES: TTSVoice[] = [
  { id: "YOq2y2Up4RgXP2HyXjE5", name: "Rachel" },
  { id: "AZnzlk1XvdvUeBnXmlNG", name: "Sam" },
  { id: "CwhRBWXzGAHq8TQ4Fs17", name: "Roger" },
  { id: "EXAVITQu4vr4xnSDxMaL", name: "Sarah" },
  { id: "LyssAJIZ4k3DJGW7QTaO", name: "Elliot" },
  { id: "MFZMEXqYqFN5YSiJqHxo", name: "Charlie" },
  { id: "NFY5qYlrZGkZ9jJp9J4j", name: "Emily" },
  { id: "nP4h3Nz5tJaqBqu4zDu4", name: "Aria" },
  { id: "oWAxZDx7T60O2gCoV7ko", name: "Adam" },
  { id: "pNInz6obpgDQGcFmaJgB", name: "Arnold" },
  { id: "pmqG7SzvK3r3HXQ8N6ZQ", name: "Bella" },
  { id: "rObUfCSj2PE5ZuEbZkrk", name: "Dom" },
  { id: "rpGA7VF8a1eY2Ayt7iM6", name: "Dorothy" },
  { id: "tw1kZhNv6T3jtsJCJSt4", name: "Fin" },
  { id: "wbJZE5tDdP3V3uKPYb1W", name: "Freya" },
  { id: "xQ8P86CzPvXP2Y4QxYOq", name: "Grace" },
  { id: "xR4vQ8J3tN2YwZcKfDm6", name: "James" },
  { id: "yHAj8S3qP5RwN7YvXtZ1", name: "Jenny" },
  { id: "z9Q7X6Y4jV2NtR8PwLm3", name: "Matthew" },
]

const DEFAULT_MODEL_ID = "eleven_v3"
const DEFAULT_OUTPUT_FORMAT = "mp3_44100_128"
const BASE_URL = "https://api.elevenlabs.io/v1"

function extensionFromOutputFormat(format: string): string {
  const lower = format.toLowerCase()
  if (lower.startsWith("wav")) return "wav"
  if (lower.startsWith("mp3")) return "mp3"
  return "bin"
}

export class ElevenLabsProvider implements TTSProvider {
  readonly id = "elevenlabs"
  readonly name = "ElevenLabs"
  readonly description = "ElevenLabs Text-to-Speech API"

  private config: TTSProviderConfig | null = null
  private apiKey: string | null = null

  async getConfig(): Promise<TTSProviderConfig> {
    if (this.config) return this.config

    const apiKeyFilePath = path.join(Global.Path.config, "secrets/elevenlabs-key")

    const envKey =
      process.env.NIKCLI_ELEVENLABS_API_KEY ??
      process.env.ELEVENLABS_API_KEY ??
      process.env.XI_API_KEY ??
      process.env.ELEVENLABS_KEY

    if (envKey && envKey.trim()) {
      this.apiKey = envKey.trim()
    } else {
      const file = Bun.file(apiKeyFilePath)
      if (await file.exists()) {
        this.apiKey = (await file.text()).trim()
      }
    }

    if (!this.apiKey) {
      throw new Error(
        [
          "ElevenLabs API key not found.",
          "",
          "Set NIKCLI_ELEVENLABS_API_KEY (or ELEVENLABS_API_KEY), or create:",
          apiKeyFilePath,
          "with your API key.",
        ].join("\n"),
      )
    }

    this.config = {
      apiKey: this.apiKey,
      baseURL: process.env.NIKCLI_ELEVENLABS_BASE_URL ?? BASE_URL,
      timeout: 30000,
    }

    return this.config
  }

  async getVoices(): Promise<TTSVoice[]> {
    // Return static list - could fetch from API if needed
    return ELEVENLABS_VOICES
  }

  async speak(request: TTSRequest, options?: { signal?: AbortSignal }): Promise<TTSResponse> {
    const config = await this.getConfig()
    const modelId = request.modelId ?? DEFAULT_MODEL_ID
    const outputFormat = request.outputFormat ?? DEFAULT_OUTPUT_FORMAT
    const stability = request.stability ?? 0.5
    const similarityBoost = request.similarityBoost ?? 0.75
    const speed = request.speed ?? 1.0

    const url = `${config.baseURL}/text-to-speech/${request.voiceId}?output_format=${encodeURIComponent(outputFormat)}`

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "xi-api-key": config.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: request.text,
        model_id: modelId,
        voice_settings: {
          stability,
          similarity_boost: similarityBoost,
          style: 0,
          use_speaker_boost: true,
          speed,
        },
      }),
      signal: options?.signal,
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => "")
      let parsedError: any = {}
      try {
        if (errorText) parsedError = JSON.parse(errorText)
      } catch {
        /* ignore */
      }

      const rawDetail = parsedError.detail
      const errorDetail =
        rawDetail !== null && rawDetail !== undefined && typeof rawDetail === "object"
          ? ((rawDetail as any).message ?? JSON.stringify(rawDetail))
          : (rawDetail ?? parsedError.message ?? errorText)

      switch (response.status) {
        case 401:
          throw new Error(`ElevenLabs authentication failed (401). Your API key may be invalid or expired.`)
        case 429:
          throw new Error(`ElevenLabs rate limit exceeded (429). Too many requests.`)
        case 400:
          throw new Error(`ElevenLabs bad request (400): ${errorDetail}`)
        default:
          throw new Error(`ElevenLabs error (${response.status}): ${errorDetail}`)
      }
    }

    const audioBuffer = await response.arrayBuffer()
    const contentType = extensionFromOutputFormat(outputFormat)

    return {
      audio: audioBuffer,
      contentType,
      metadata: {
        provider: this.id,
        modelId,
        voiceId: request.voiceId,
      },
    }
  }

  async validate(): Promise<{ valid: boolean; error?: string }> {
    try {
      const config = await this.getConfig()
      if (!config.apiKey) {
        return { valid: false, error: "API key not configured" }
      }

      // Test with a simple metadata request
      const response = await fetch(`${config.baseURL}/voices`, {
        headers: {
          "xi-api-key": config.apiKey,
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

// Export singleton instance
export const elevenLabsProvider = new ElevenLabsProvider()

// Export voice list for easy access
export const ELEVENLABS_VOICES_LIST = ELEVENLABS_VOICES
// Backward-compatible alias (kept intentionally)
export const ELEVENTLABS_VOICES_LIST = ELEVENLABS_VOICES
