/**
 * TTS Provider Abstraction
 *
 * This module defines the interface for Text-to-Speech providers.
 * Multiple providers are supported (e.g., ElevenLabs, OpenRouter),
 * and the architecture allows adding more providers over time.
 */

export interface TTSVoice {
  id: string
  name: string
}

export interface TTSProviderConfig {
  apiKey: string
  baseURL?: string
  timeout?: number
}

export interface TTSRequest {
  text: string
  voiceId: string
  modelId?: string
  outputFormat?: string
  stability?: number
  similarityBoost?: number
  speed?: number
}

export interface TTSResponse {
  audio: ArrayBuffer
  contentType: string
  metadata: {
    provider: string
    modelId: string
    voiceId: string
    duration?: number
  }
}

export interface TTSProvider {
  /** Unique identifier for this provider */
  readonly id: string
  /** Human-readable name */
  readonly name: string
  /** Brief description */
  readonly description: string

  /** List of available voices/models for this provider */
  getVoices(): Promise<TTSVoice[]>

  /** Convert text to speech */
  speak(request: TTSRequest, options?: { signal?: AbortSignal }): Promise<TTSResponse>

  /** Validate that the provider is properly configured */
  validate(): Promise<{ valid: boolean; error?: string }>
}

/**
 * Registry for TTS providers
 */
export class TTSProviderRegistry {
  private providers = new Map<string, TTSProvider>()

  register(provider: TTSProvider): void {
    this.providers.set(provider.id, provider)
  }

  get(id: string): TTSProvider | undefined {
    return this.providers.get(id)
  }

  list(): TTSProvider[] {
    return Array.from(this.providers.values())
  }

  has(id: string): boolean {
    return this.providers.has(id)
  }
}

// Global registry instance
export const ttsRegistry = new TTSProviderRegistry()
