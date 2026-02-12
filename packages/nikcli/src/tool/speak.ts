import z from "zod"
import path from "path"
import os from "os"
import { spawn } from "child_process"
import { unlinkSync } from "fs"

import { Tool } from "./tool"
import { Global } from "@/global"
import { Log } from "@/util/log"

const log = Log.create({ service: "tool.speak" })

const DEFAULT_VOICE_ID = "YOq2y2Up4RgXP2HyXjE5"
const DEFAULT_MODEL_ID = "eleven_v3"
const DEFAULT_OUTPUT_FORMAT = "mp3_44100_128"

const DEFAULT_TIMEOUT_MS = 30_000
const MAX_TIMEOUT_MS = 120_000
const MAX_TEXT_LENGTH = 800

const API_KEY_FILEPATH = path.join(Global.Path.config, "secrets", "elevenlabs-key")

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

async function loadElevenLabsApiKey(): Promise<string> {
  const env =
    process.env.NIKCLI_ELEVENLABS_API_KEY ??
    process.env.ELEVENLABS_API_KEY ??
    process.env.XI_API_KEY ??
    process.env.ELEVENLABS_KEY

  if (env && env.trim()) return env.trim()

  const file = Bun.file(API_KEY_FILEPATH)
  if (await file.exists()) {
    const value = (await file.text()).trim()
    if (value) return value
  }

  throw new Error(
    [
      "ElevenLabs API key not found.",
      "",
      "Set NIKCLI_ELEVENLABS_API_KEY (or ELEVENLABS_API_KEY), or create:",
      API_KEY_FILEPATH,
      "with your API key.",
    ].join("\n"),
  )
}

function normalizeText(input: string): { text: string; truncated: boolean } {
  const text = input.trim()
  if (!text) throw new Error("Text is required")
  if (text.length <= MAX_TEXT_LENGTH) return { text, truncated: false }
  return { text: text.slice(0, MAX_TEXT_LENGTH - 3) + "...", truncated: true }
}

function extensionFromOutputFormat(format: string) {
  const lower = format.toLowerCase()
  if (lower.startsWith("wav")) return "wav"
  if (lower.startsWith("mp3")) return "mp3"
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

This tool uses ElevenLabs v3 (eleven_v3) which supports inline audio tags.

Audio tag examples:
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
    text: z
      .string()
      .describe("Text to speak. Can include ElevenLabs v3 audio tags like [laughs], [whispers], [excited], etc."),
    stability: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe("Voice stability (0-1). Lower = more expressive. Default: 0.5"),
    similarityBoost: z.number().min(0).max(1).optional().describe("Voice similarity boost (0-1). Default: 0.75"),
    speed: z.number().min(0.5).max(2).optional().describe("Speech speed multiplier (0.5-2). Default: 1.0"),
    volume: z.number().min(0).max(2).optional().describe("Playback volume (0-2). Default: 1.0"),
    voiceId: z.string().optional().describe(`ElevenLabs voice ID (default: ${DEFAULT_VOICE_ID})`),
    modelId: z.string().optional().describe(`ElevenLabs model ID (default: ${DEFAULT_MODEL_ID})`),
    outputFormat: z.string().optional().describe(`ElevenLabs output format (default: ${DEFAULT_OUTPUT_FORMAT})`),
    timeoutMs: z
      .number()
      .int()
      .positive()
      .optional()
      .describe(`Request timeout in milliseconds (default: ${DEFAULT_TIMEOUT_MS})`),
  }),
  async execute(params, ctx) {
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

    const apiKey = await loadElevenLabsApiKey()

    const voiceId = params.voiceId ?? process.env.NIKCLI_ELEVENLABS_VOICE_ID ?? DEFAULT_VOICE_ID
    const modelId = params.modelId ?? process.env.NIKCLI_ELEVENLABS_MODEL_ID ?? DEFAULT_MODEL_ID
    const outputFormat = params.outputFormat ?? process.env.NIKCLI_ELEVENLABS_OUTPUT_FORMAT ?? DEFAULT_OUTPUT_FORMAT

    const stability = params.stability ?? 0.5
    const similarityBoost = params.similarityBoost ?? 0.75
    const speed = params.speed ?? 1.0
    const volume = params.volume ?? 1.0
    const timeoutMs = clampNumber(params.timeoutMs ?? DEFAULT_TIMEOUT_MS, 1000, MAX_TIMEOUT_MS)

    const normalized = normalizeText(params.text)

    await ctx.ask({
      permission: "speak",
      patterns: [`elevenlabs:${voiceId}`],
      always: ["elevenlabs*"],
      metadata: {
        provider: "elevenlabs",
        voiceId,
        modelId,
        outputFormat,
        player: player.name,
        timeoutMs,
      },
    })

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

    const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=${encodeURIComponent(outputFormat)}`
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: normalized.text,
        model_id: modelId,
        voice_settings: {
          stability,
          similarity_boost: similarityBoost,
          style: 0,
          use_speaker_boost: true,
          speed,
        },
      }),
      signal: AbortSignal.any([controller.signal, ctx.abort]),
    }).finally(() => clearTimeout(timeoutId))

    if (!response.ok) {
      const errorText = await response.text().catch(() => "")
      const suffix = errorText ? `\n\n${errorText}` : ""
      throw new Error(`ElevenLabs API error (${response.status}): ${response.statusText}${suffix}`)
    }

    const audioBuffer = Buffer.from(await response.arrayBuffer())
    const ext = extensionFromOutputFormat(outputFormat)
    const tempFile = path.join(os.tmpdir(), `nikcli-speak-${Date.now()}-${Math.random().toString(16).slice(2)}.${ext}`)

    await Bun.write(tempFile, audioBuffer)
    playAudioNonBlocking(player, tempFile, volume)

    const preview = normalized.text.length > 80 ? normalized.text.slice(0, 80) + "..." : normalized.text
    const truncated = normalized.truncated ? " (text truncated)" : ""

    return {
      title: "Speak",
      output: [
        `Playing speech (non-blocking): "${preview}"${truncated}`,
        `Provider: ElevenLabs (${modelId})`,
        `Voice: ${voiceId}`,
        `Player: ${player.name}`,
      ].join("\n"),
      metadata: {
        provider: "elevenlabs",
        voiceId,
        modelId,
        outputFormat,
        player: player.name,
        textTruncated: normalized.truncated,
      },
    }
  },
})
