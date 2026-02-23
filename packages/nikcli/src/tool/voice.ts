import z from "zod"
import os from "os"
import { Tool } from "./tool"
import { Config } from "@/config/config"
import { Auth } from "@/auth"

const OPENROUTER_STT_URL = "https://openrouter.ai/api/v1/audio/transcriptions"

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

  async function getApiKey(): Promise<string> {
    const config = await Config.get()
    const auth = await Auth.get("openrouter")
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
    const sox = Bun.which("rec")
    if (sox) {
      return { cmd: sox, args: [] }
    }
    const ffmpeg = Bun.which("ffmpeg")
    if (ffmpeg) {
      return { cmd: ffmpeg, args: [] }
    }
    return null
  }

  return {
    description: "Record audio from microphone and transcribe it to text using OpenRouter Whisper",
    parameters,
    async execute(args) {
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

        tempAudioPath = `${os.tmpdir()}/nikcli_voice_${Date.now()}.wav`

        if (recorder.cmd.includes("rec")) {
          recordingProcess = Bun.spawn([recorder.cmd, tempAudioPath, "silence", "1", "0.1", "1%", "-1", "1.0", "1%"], {
            onExit() {
              recordingProcess = null
            },
          })
        } else if (recorder.cmd.includes("ffmpeg")) {
          recordingProcess = Bun.spawn(
            [
              recorder.cmd,
              "-f",
              "alsa",
              "-i",
              "default",
              "-t",
              String(duration),
              "-acodec",
              "pcm_s16le",
              tempAudioPath,
            ],
            {
              onExit() {
                recordingProcess = null
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

        recordingProcess.kill()
        recordingProcess = null

        try {
          const apiKey = await getApiKey()
          const audioData = await Bun.file(tempAudioPath).arrayBuffer()

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

          await Bun.write(tempAudioPath, "")

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
