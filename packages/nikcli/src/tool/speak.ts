import z from "zod"
import path from "path"
import os from "os"
import { spawn } from "child_process"
import { unlinkSync } from "fs"

import { Tool } from "./tool"
import { Log } from "@/util/log"
import { Config } from "@/config/config"
import { ttsRegistry, type TTSProvider } from "./speak/provider"
import { ELEVENLABS_VOICES_LIST, elevenLabsProvider } from "./speak/elevenlabs"
import { OPENROUTER_VOICES_LIST, openRouterProvider } from "./speak/openrouter"

const log = Log.create({ service: "tool.speak" })

const DEFAULT_VOICE_ID = "YOq2y2Up4RgXP2HyXjE5"
const DEFAULT_MODEL_ID = "eleven_v3"
const DEFAULT_OUTPUT_FORMAT = "mp3_44100_128"
const OPENROUTER_DEFAULT_VOICE_ID = "alloy"
const OPENROUTER_DEFAULT_MODEL_ID = "openai/gpt-audio-mini"
const OPENROUTER_DEFAULT_OUTPUT_FORMAT = "mp3"
const DEFAULT_PROVIDER = "elevenlabs"

// Register built-in providers
ttsRegistry.register(elevenLabsProvider)
ttsRegistry.register(openRouterProvider)

function defaultVoiceIdForProvider(providerId: string): string {
  if (providerId === "openrouter") return OPENROUTER_DEFAULT_VOICE_ID
  return DEFAULT_VOICE_ID
}

function defaultModelIdForProvider(providerId: string): string {
  if (providerId === "openrouter") return OPENROUTER_DEFAULT_MODEL_ID
  return DEFAULT_MODEL_ID
}

function defaultOutputFormatForProvider(providerId: string): string {
  if (providerId === "openrouter") return OPENROUTER_DEFAULT_OUTPUT_FORMAT
  return DEFAULT_OUTPUT_FORMAT
}

function envVoiceIdForProvider(providerId: string): string | undefined {
  if (providerId === "openrouter") {
    return process.env.NIKCLI_OPENROUTER_VOICE_ID
  }
  return process.env.NIKCLI_ELEVENLABS_VOICE_ID
}

function envModelIdForProvider(providerId: string): string | undefined {
  if (providerId === "openrouter") {
    return process.env.NIKCLI_OPENROUTER_MODEL_ID
  }
  return process.env.NIKCLI_ELEVENLABS_MODEL_ID
}

function envOutputFormatForProvider(providerId: string): string | undefined {
  if (providerId === "openrouter") {
    return process.env.NIKCLI_OPENROUTER_OUTPUT_FORMAT
  }
  return process.env.NIKCLI_ELEVENLABS_OUTPUT_FORMAT
}

// Helper to resolve provider from config/env/params
async function resolveProvider(
  providerParam?: string,
  configProvider?: string,
): Promise<{ provider: TTSProvider; id: string }> {
  const providerId = providerParam ?? configProvider ?? process.env.NIKCLI_SPEAK_PROVIDER ?? DEFAULT_PROVIDER

  const provider = ttsRegistry.get(providerId)
  if (!provider) {
    const available = ttsRegistry
      .list()
      .map((p) => p.id)
      .join(", ")
    throw new Error(`Unknown TTS provider: ${providerId}. Available providers: ${available}`)
  }

  return { provider, id: providerId }
}

// Voice validation - currently only validates ElevenLabs voices
const KNOWN_ELEVENLABS_VOICES = ELEVENLABS_VOICES_LIST.map((voice) => voice.id)
const KNOWN_OPENROUTER_VOICES = new Set(OPENROUTER_VOICES_LIST.map((voice) => voice.id.toLowerCase()))

// ElevenLabs voice IDs are typically 21-character alphanumeric strings
const VOICE_ID_PATTERN = /^[a-zA-Z0-9_-]{21}$/

function validateVoiceId(voiceId: string, providerId: string): { valid: boolean; isKnown: boolean } {
  if (providerId === "openrouter") {
    const normalized = voiceId.toLowerCase()
    const isKnown = KNOWN_OPENROUTER_VOICES.has(normalized)
    return { valid: isKnown, isKnown }
  }

  // For now, only strictly validate ElevenLabs voices by pattern
  if (providerId !== "elevenlabs") {
    return { valid: true, isKnown: false }
  }

  const matchesPattern = VOICE_ID_PATTERN.test(voiceId)
  const isKnown = KNOWN_ELEVENLABS_VOICES.includes(voiceId)
  return { valid: matchesPattern, isKnown }
}

function resolveVoiceId(
  inputVoiceId: string | undefined,
  configVoiceId: string | undefined,
  envVoiceId: string | undefined,
  providerId: string,
): string {
  const providedVoiceId = inputVoiceId ?? configVoiceId ?? envVoiceId

  if (!providedVoiceId) {
    return defaultVoiceIdForProvider(providerId)
  }

  const validation = validateVoiceId(providedVoiceId, providerId)

  if (!validation.valid) {
    log.warn("invalid voiceId format - using default", {
      provided: providedVoiceId,
      expected: `pattern: ${VOICE_ID_PATTERN.source}`,
    })
    return defaultVoiceIdForProvider(providerId)
  }

  if (!validation.isKnown) {
    log.warn("voiceId not in known voices list - allowing anyway", {
      voiceId: providedVoiceId,
      providerId,
      hint: "voice may work but is not in the known voices list",
    })
  }

  return providedVoiceId
}

const DEFAULT_TIMEOUT_MS = 30_000
const MAX_TIMEOUT_MS = 120_000
const MAX_TEXT_LENGTH = 800

type AudioPlayer = {
  name: "afplay" | "ffplay" | "mpg123"
  command: string
  args: (input: { filePath: string; volume: number }) => string[]
}

function clampNumber(value: number, min: number, max: number): number {
  if (value < min) return min
  if (value > max) return max
  return value
}

function detectPlayer(): AudioPlayer | undefined {
  const afplay = Bun.which("afplay")
  if (process.platform === "darwin" && afplay) {
    return {
      name: "afplay",
      command: afplay,
      args: ({ filePath, volume }) => ["-v", String(clampNumber(volume, 0, 2)), filePath],
    }
  }

  const ffplay = Bun.which("ffplay")
  if (ffplay) {
    // ffplay expects volume in 0-100.
    return {
      name: "ffplay",
      command: ffplay,
      args: ({ filePath, volume }) => {
        const vol = Math.round(clampNumber(volume, 0, 1) * 100)
        return ["-nodisp", "-autoexit", "-loglevel", "error", "-volume", String(vol), filePath]
      },
    }
  }

  const mpg123 = Bun.which("mpg123")
  if (mpg123) {
    return {
      name: "mpg123",
      command: mpg123,
      args: ({ filePath }) => ["-q", filePath],
    }
  }

  return undefined
}

function normalizeText(input: string): { text: string; truncated: boolean } {
  const text = input.trim()
  if (!text) throw new Error("Text is required")
  if (text.length <= MAX_TEXT_LENGTH) return { text, truncated: false }
  return { text: text.slice(0, MAX_TEXT_LENGTH - 3) + "...", truncated: true }
}

function extensionFromContentType(contentType: string) {
  const lower = contentType.toLowerCase()
  if (lower.includes("wav")) return "wav"
  if (lower.includes("mp3")) return "mp3"
  return "bin"
}

function playAudioNonBlocking(player: AudioPlayer, filePath: string, volume: number) {
  const cleanup = () => {
    try {
      unlinkSync(filePath)
    } catch {
      // Ignore cleanup failures.
    }
  }

  const child = spawn(player.command, player.args({ filePath, volume }), {
    detached: process.platform !== "win32",
    stdio: "ignore",
  })

  child.unref()
  child.once("exit", cleanup)
  child.once("error", (error) => {
    log.error("audio playback failed", { error: error.message, player: player.name })
    cleanup()
  })
}

const DESCRIPTION = `Convert text to speech and play it on the machine speakers (non-blocking).

This tool supports multiple TTS providers (ElevenLabs and OpenRouter).

Audio tag examples (ElevenLabs):
  [laughs] [sighs] [excited] [sad] [angry]
  [whispers] [shouts] [dramatically] [calmly]
  [British accent] [strong French accent]

Usage guidance:
- Use in short bursts to notify about important state changes
- Good for: task completion, errors requiring attention, questions needing user input
- Keep messages concise (1-2 sentences)

Note: audio plays on the device running nikcli.`

export const SpeakTool = Tool.define("speak", {
  description: DESCRIPTION,
  parameters: z.object({
    text: z.string().describe("Text to speak. Can include audio tags like [laughs], [whispers], [excited], etc."),
    provider: z.string().optional().describe("TTS provider (e.g., elevenlabs, openrouter)"),
    stability: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe("Voice stability (0-1). Lower = more expressive. Default: 0.5"),
    similarityBoost: z.number().min(0).max(1).optional().describe("Voice similarity boost (0-1). Default: 0.75"),
    speed: z.number().min(0.5).max(2).optional().describe("Speech speed multiplier (0.5-2). Default: 1.0"),
    volume: z.number().min(0).max(2).optional().describe("Playback volume (0-2). Default: 1.0"),
    voiceId: z.string().optional().describe("TTS voice ID (provider-dependent default)"),
    modelId: z.string().optional().describe("TTS model ID (provider-dependent default)"),
    outputFormat: z.string().optional().describe("TTS output format (provider-dependent default)"),
    timeoutMs: z
      .number()
      .int()
      .positive()
      .optional()
      .describe(`Request timeout in milliseconds (default: ${DEFAULT_TIMEOUT_MS})`),
  }),
  async execute(params, ctx) {
    const config = await Config.get()
    const speakConfig = config.speak ?? {}

    const player = detectPlayer()
    if (!player) {
      throw new Error(
        [
          "No supported audio player found.",
          "",
          "Supported players:",
          "- macOS: afplay",
          "- ffmpeg: ffplay",
          "- mpg123: mpg123",
        ].join("\n"),
      )
    }

    // Resolve provider
    const { provider: ttsProvider, id: providerId } = await resolveProvider(params.provider, speakConfig.provider)

    const voiceId = resolveVoiceId(params.voiceId, speakConfig.model, envVoiceIdForProvider(providerId), providerId)
    const modelId =
      params.modelId ??
      speakConfig.modelId ??
      envModelIdForProvider(providerId) ??
      defaultModelIdForProvider(providerId)
    const outputFormat =
      params.outputFormat ??
      speakConfig.outputFormat ??
      envOutputFormatForProvider(providerId) ??
      defaultOutputFormatForProvider(providerId)

    const stability = params.stability ?? 0.5
    const similarityBoost = params.similarityBoost ?? 0.75
    const speed = params.speed ?? 1.0
    const volume = params.volume ?? 1.0
    const timeoutMs = clampNumber(params.timeoutMs ?? DEFAULT_TIMEOUT_MS, 1000, MAX_TIMEOUT_MS)

    const normalized = normalizeText(params.text)

    await ctx.ask({
      permission: "speak",
      patterns: [`${providerId}:${voiceId}`],
      always: [`${providerId}*`],
      metadata: {
        provider: providerId,
        voiceId,
        modelId,
        outputFormat,
        player: player.name,
        timeoutMs,
      },
    })

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const ttsResponse = await ttsProvider
        .speak(
          {
            text: normalized.text,
            voiceId,
            modelId,
            outputFormat,
            stability,
            similarityBoost,
            speed,
          },
          { signal: AbortSignal.any([controller.signal, ctx.abort]) },
        )
        .finally(() => clearTimeout(timeoutId))

      const ext = extensionFromContentType(ttsResponse.contentType)
      const tempFile = path.join(
        os.tmpdir(),
        `nikcli-speak-${Date.now()}-${Math.random().toString(16).slice(2)}.${ext}`,
      )

      await Bun.write(tempFile, ttsResponse.audio)
      playAudioNonBlocking(player, tempFile, volume)

      const preview = normalized.text.length > 80 ? normalized.text.slice(0, 80) + "..." : normalized.text
      const truncated = normalized.truncated ? " (text truncated)" : ""

      return {
        title: "Speak",
        output: [
          `Playing speech (non-blocking): "${preview}"${truncated}`,
          `Provider: ${ttsProvider.name} (${modelId})`,
          `Voice: ${voiceId}`,
          `Player: ${player.name}`,
        ].join("\n"),
        metadata: {
          provider: providerId,
          voiceId,
          modelId,
          outputFormat,
          player: player.name,
          textTruncated: normalized.truncated,
        },
      }
    } catch (fetchError: any) {
      const errorMessage = fetchError.cause?.message ?? fetchError.message

      if (fetchError.name === "AbortError") {
        if (ctx.abort.aborted) {
          log.warn("request cancelled by user", { timeoutMs })
          throw new Error("Speech request was cancelled")
        }
        log.error("request timed out", { timeoutMs, voiceId, modelId, provider: providerId })
        throw new Error(
          `${ttsProvider.name} request timed out after ${timeoutMs}ms. Try increasing the timeout with the timeoutMs parameter.`,
        )
      }

      log.error(`network error calling ${ttsProvider.name} API`, {
        error: errorMessage,
        voiceId,
        modelId,
        provider: providerId,
      })

      if (errorMessage.includes("ENOTFOUND") || errorMessage.includes("dns")) {
        throw new Error(
          `Unable to connect to ${ttsProvider.name} API. Please check your internet connection and try again.`,
        )
      }

      if (errorMessage.includes("ECONNREFUSED")) {
        throw new Error(
          `Connection refused when contacting ${ttsProvider.name} API. The service may be unavailable. Please try again later.`,
        )
      }

      throw new Error(
        `Network error calling ${ttsProvider.name} API: ${errorMessage}. Please check your internet connection and try again.`,
      )
    }
  },
})

// Export the provider registry for external use (e.g., CLI commands)
export { ttsRegistry }
