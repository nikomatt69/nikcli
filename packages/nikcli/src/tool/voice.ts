import z from "zod"
import os from "os"
import { Tool } from "./tool"
import { Config } from "@/config/config"
import { Auth } from "@/auth"
import { Log } from "@/util/log"
import DESCRIPTION from "./voice.txt"
import { Effect } from "effect"
import { runPromiseWithLayer, withCurrentInstance } from "@/effect"

const OPENROUTER_STT_URL = "https://openrouter.ai/api/v1/audio/transcriptions"
const log = Log.create({ service: "tool.voice" })

function runAuth<A, E>(effect: Effect.Effect<A, E, Auth.Service>) {
  return runPromiseWithLayer(Auth.defaultLayer, effect)
}

function configGet() {
  return runPromiseWithLayer(
    Config.defaultLayer,
    withCurrentInstance(
      Effect.gen(function* () {
        const config = yield* Config.Service
        return yield* config.get()
      }),
    ),
  )
}

const parameters = z.object({
  action: z
    .enum(["start", "stop", "status"])
    .describe("Action to perform: start recording, stop recording, or check status"),
  duration: z.number().optional().default(30).describe("Maximum recording duration in seconds (default: 30)"),
  language: z.string().optional().default("en").describe("Language code for transcription (default: en)"),
})

export const Voice = Tool.define("voice", async () => {
  let recordingProcess: ReturnType<typeof Bun.spawn> | null = null
  let tempAudioPath: string | null = null
  let recordingToken = 0

  async function cleanupTempAudio(filepath: string) {
    try {
      await Bun.file(filepath)
        .delete()
        .catch(() => {})
    } catch (error) {
      log.warn("failed to clean up temp audio", { filepath, error })
    }
  }

  async function getApiKey(): Promise<string> {
    const config = await configGet()
    const auth = await runAuth(
      Effect.gen(function* () {
        const auth = yield* Auth.Service
        return yield* auth.get("openrouter")
      }),
    )
    const fromProviderOptions = config.provider?.openrouter?.options?.apiKey

    const apiKey =
      process.env.NIKCLI_OPENROUTER_API_KEY ??
      process.env.OPENROUTER_API_KEY ??
      (auth?.type === "api" ? auth.key : undefined) ??
      (typeof fromProviderOptions === "string" ? fromProviderOptions : undefined)
    if (!apiKey) {
      throw new Error(
        "OpenRouter API key not configured. Set it in config or via OPENROUTER_API_KEY environment variable.",
      )
    }
    return apiKey
  }

  async function findRecorder(): Promise<{ cmd: string; args: string[] } | null> {
    // Pass PATH explicitly: bare `Bun.which` resolves against the PATH captured
    // when the process started, so a PATH set later (env config, a shim added by
    // the session) would be invisible.
    const options = process.env.PATH ? { PATH: process.env.PATH } : undefined
    const sox = Bun.which("rec", options)
    if (sox) {
      return { cmd: sox, args: [] }
    }
    const ffmpeg = Bun.which("ffmpeg", options)
    if (ffmpeg) {
      return { cmd: ffmpeg, args: [] }
    }
    return null
  }

  return {
    description: DESCRIPTION,
    parameters,
    async execute(args, ctx) {
      const { action, duration, language } = args

      if (action === "status") {
        return {
          title: "Voice Recording Status",
          metadata: {},
          output: recordingProcess ? "Recording in progress" : "Not recording",
        }
      }

      if (action === "start") {
        if (recordingProcess) {
          return {
            title: "Voice Recording",
            metadata: {},
            output: "Recording already in progress",
          }
        }

        const recorder = await findRecorder()
        if (!recorder) {
          return {
            title: "Voice Recording Error",
            metadata: {},
            output: "No audio recorder found. Please install sox (rec command) or ffmpeg to use voice input.",
          }
        }

        // Opening the microphone is the one irreversible thing this tool does —
        // audio is captured before anyone sees a transcript, and it leaves the
        // machine for transcription. Gate it the way `speak` gates playback.
        await ctx.ask({
          permission: "voice",
          patterns: [`record:${language}`],
          always: ["record:*"],
          metadata: { duration, language, recorder: recorder.cmd },
        })

        const audioPath = `${os.tmpdir()}/nikcli_voice_${Date.now()}.wav`
        tempAudioPath = audioPath
        const token = ++recordingToken

        // Clean up on abort
        const abortHandler = () => {
          if (recordingToken === token) {
            recordingProcess?.kill()
            recordingProcess = null
          }
          if (tempAudioPath === audioPath) {
            tempAudioPath = null
            void cleanupTempAudio(audioPath)
          }
        }
        ctx.abort.addEventListener("abort", abortHandler, { once: true })

        if (recorder.cmd.includes("rec")) {
          recordingProcess = Bun.spawn([recorder.cmd, audioPath, "silence", "1", "0.1", "1%", "-1", "1.0", "1%"], {
            windowsHide: true,
            onExit() {
              ctx.abort.removeEventListener("abort", abortHandler)
              if (recordingToken === token) {
                recordingProcess = null
              }
              if (tempAudioPath === audioPath) {
                tempAudioPath = null
                void cleanupTempAudio(audioPath)
              }
            },
          })
        } else if (recorder.cmd.includes("ffmpeg")) {
          recordingProcess = Bun.spawn(
            [recorder.cmd, "-f", "alsa", "-i", "default", "-t", String(duration), "-acodec", "pcm_s16le", audioPath],
            {
              windowsHide: true,
              onExit() {
                ctx.abort.removeEventListener("abort", abortHandler)
                if (recordingToken === token) {
                  recordingProcess = null
                }
                if (tempAudioPath === audioPath) {
                  tempAudioPath = null
                  void cleanupTempAudio(audioPath)
                }
              },
            },
          )
        }

        return {
          title: "Voice Recording Started",
          metadata: {},
          output: `Recording audio for up to ${duration} seconds... Press the voice keybind again to stop.`,
        }
      }

      if (action === "stop") {
        if (!recordingProcess || !tempAudioPath) {
          return {
            title: "Voice Recording",
            metadata: {},
            output: "No recording in progress",
          }
        }

        const process = recordingProcess
        const audioPath = tempAudioPath
        tempAudioPath = null
        process.kill()
        await process.exited
        if (recordingProcess === process) {
          recordingProcess = null
        }

        try {
          const apiKey = await getApiKey()
          const audioData = await Bun.file(audioPath).arrayBuffer()

          const formData = new FormData()
          formData.append("file", new Blob([audioData], { type: "audio/wav" }), "audio.wav")
          formData.append("model", "openai/whisper-1")
          formData.append("language", language)

          const response = await fetch(OPENROUTER_STT_URL, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
            },
            body: formData,
          })

          if (!response.ok) {
            const errorText = await response.text()
            throw new Error(`OpenRouter API error: ${response.status} - ${errorText}`)
          }

          const result = (await response.json()) as { text?: string }
          const transcript = result.text ?? ""

          if (!transcript) {
            return {
              title: "Voice Transcription",
              metadata: {},
              output: "No speech detected in the recording.",
            }
          }

          return {
            title: "Voice Transcription",
            metadata: {},
            output: `Transcribed: ${transcript}`,
          }
        } catch (error) {
          return {
            title: "Voice Transcription Error",
            metadata: {},
            output: `Failed to transcribe audio: ${error instanceof Error ? error.message : "Unknown error"}`,
          }
        } finally {
          await cleanupTempAudio(audioPath)
        }
      }

      return {
        title: "Voice",
        metadata: {},
        output: "Unknown action",
      }
    },
  }
})
