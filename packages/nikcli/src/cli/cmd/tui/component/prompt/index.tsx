import { BoxRenderable, TextareaRenderable, MouseEvent, PasteEvent } from "@opentui/core"
import {
  createEffect,
  createMemo,
  type JSX,
  onMount,
  createSignal,
  onCleanup,
  on,
  Show,
  Switch,
  Match,
  For,
} from "solid-js"
import "opentui-spinner/solid"
import { useLocal } from "@tui/context/local"
import { useTheme } from "@tui/context/theme"
import { EmptyBorder } from "@tui/component/border"
import { useSDK } from "@tui/context/sdk"
import { useRoute } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { Identifier } from "@/id/id"
import { createStore, produce } from "solid-js/store"
import { useKeybind } from "@tui/context/keybind"
import { usePromptHistory, type PromptInfo } from "./history"
import { usePromptStash } from "./stash"
import { DialogStash } from "../dialog-stash"
import { type AutocompleteRef, Autocomplete } from "./autocomplete"
import { useCommandDialog } from "../dialog-command"
import { useRenderer } from "@opentui/solid"
import { Editor } from "@tui/util/editor"
import { useExit } from "../../context/exit"
import { Clipboard } from "../../util/clipboard"
import type { FilePart } from "@nikcli-ai/sdk/v2"
import { TuiEvent } from "../../event"
import { iife } from "@/util/iife"
import { Locale } from "@/util/locale"
import { formatDuration } from "@/util/format"
import { createColors, createFrames } from "../../ui/spinner.ts"
import type { SpinnerStyle } from "../dialog-settings/spinner"
import { useDialog } from "@tui/ui/dialog"
import { DialogProvider as DialogProviderConnect } from "../dialog-provider"
import { DialogAlert } from "../../ui/dialog-alert"
import { useToast } from "../../ui/toast"
import { useKV } from "../../context/kv"
import { useTextareaKeybindings } from "../textarea-keybindings"
import { DialogThemeCreate } from "../dialog-theme-create"
import { DialogRagModel } from "../dialog-rag-model"
import { DialogImageModel } from "../dialog-image-model"
import { DialogSpeakModel } from "../dialog-speak-model"
import { DialogRemote } from "../dialog-remote"
import { DialogSubagent } from "@tui/routes/session/dialog-subagent"
import os from "os"
import path from "path"
import { rmSync } from "fs"
import { Auth } from "@/auth"

export type PromptProps = {
  sessionID?: string
  workspaceID?: string
  visible?: boolean
  disabled?: boolean
  onSubmit?: () => void
  ref?: (ref: PromptRef) => void
  hint?: JSX.Element
  showPlaceholder?: boolean
}

export type PromptRef = {
  focused: boolean
  current: PromptInfo
  set(prompt: PromptInfo): void
  reset(): void
  blur(): void
  focus(): void
  submit(): void
}

const PLACEHOLDERS = ["Fix a TODO in the codebase", "What is the tech stack of this project?", "Fix broken tests"]
const SHELL_PLACEHOLDERS = ["ls -la", "git status", "pwd"]
const VOICE_TRANSCRIBE_MODEL = "openai/gpt-audio-mini"
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
const SWIFT_MIC_PERMISSION_ERROR = "__NIKCLI_MIC_PERMISSION_DENIED__"

const SWIFT_RECORDER_SOURCE = String.raw`
import Foundation
import AVFoundation

let permissionMarker = "__NIKCLI_MIC_PERMISSION_DENIED__"

guard CommandLine.arguments.count >= 2 else {
  fputs("missing output path\n", stderr)
  exit(2)
}

let outputPath = CommandLine.arguments[1]
let outputURL = URL(fileURLWithPath: outputPath)

let semaphore = DispatchSemaphore(value: 0)
var granted = false

AVCaptureDevice.requestAccess(for: .audio) { allowed in
  granted = allowed
  semaphore.signal()
}

_ = semaphore.wait(timeout: .now() + 30)

if !granted {
  fputs(permissionMarker + "\n", stderr)
  exit(13)
}

let settings: [String: Any] = [
  AVFormatIDKey: Int(kAudioFormatLinearPCM),
  AVSampleRateKey: 16000,
  AVNumberOfChannelsKey: 1,
  AVLinearPCMBitDepthKey: 16,
  AVLinearPCMIsBigEndianKey: false,
  AVLinearPCMIsFloatKey: false,
]

do {
  let recorder = try AVAudioRecorder(url: outputURL, settings: settings)
  recorder.prepareToRecord()

  if !recorder.record() {
    fputs("failed to start recording\n", stderr)
    exit(14)
  }

  signal(SIGINT, SIG_IGN)
  signal(SIGTERM, SIG_IGN)

  let stop: () -> Void = {
    recorder.stop()
    exit(0)
  }

  let sigintSource = DispatchSource.makeSignalSource(signal: SIGINT, queue: .main)
  sigintSource.setEventHandler(handler: stop)
  sigintSource.resume()

  let sigtermSource = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
  sigtermSource.setEventHandler(handler: stop)
  sigtermSource.resume()

  RunLoop.main.run()
} catch {
  fputs("recorder error: \(error)\n", stderr)
  exit(15)
}
`

export function Prompt(props: PromptProps) {
  let input: TextareaRenderable
  let anchor: BoxRenderable
  let autocomplete: AutocompleteRef

  const keybind = useKeybind()
  const local = useLocal()
  const sdk = useSDK()
  const route = useRoute()
  const sync = useSync()
  const dialog = useDialog()
  const toast = useToast()
  const status = createMemo(() => sync.data.session_status?.[props.sessionID ?? ""] ?? { type: "idle" })
  const history = usePromptHistory()
  const stash = usePromptStash()
  const command = useCommandDialog()
  const renderer = useRenderer()
  const { theme, syntax } = useTheme()
  const kv = useKV()
  const ads = createMemo(() => sync.data.config.ads)
  const [currentAd, setCurrentAd] = createSignal<string | null>(null)
  const [voiceStatus, setVoiceStatus] = createSignal<"idle" | "recording" | "transcribing">("idle")

  let voiceRecorder: ReturnType<typeof Bun.spawn> | null = null
  let voiceAudioPath: string | null = null
  let voiceAutoStopTimer: ReturnType<typeof setTimeout> | undefined
  let voicePressStartedAt = 0
  let swiftRecorderScriptPath: string | null = null
  let hasShownMicHint = false

  function cleanupVoiceAudio(filePath: string | null) {
    if (!filePath) return
    try {
      rmSync(filePath, { force: true })
    } catch {
      // ignore cleanup errors
    }
  }

  async function ensureSwiftRecorderScriptPath(): Promise<string | null> {
    if (process.platform !== "darwin") return null
    if (swiftRecorderScriptPath) return swiftRecorderScriptPath

    const swift = Bun.which("swift")
    if (!swift) return null

    const scriptPath = path.join(os.tmpdir(), "nikcli-mic-recorder.swift")
    const file = Bun.file(scriptPath)
    const exists = await file.exists()

    if (!exists) {
      await Bun.write(scriptPath, SWIFT_RECORDER_SOURCE)
    } else {
      const current = await file.text().catch(() => "")
      if (current !== SWIFT_RECORDER_SOURCE) {
        await Bun.write(scriptPath, SWIFT_RECORDER_SOURCE)
      }
    }

    swiftRecorderScriptPath = scriptPath
    return swiftRecorderScriptPath
  }

  async function detectVoiceRecorder(filePath: string): Promise<{ command: string[]; name: string } | null> {
    const ffmpeg = Bun.which("ffmpeg")
    if (ffmpeg) {
      if (process.platform === "darwin") {
        return {
          name: "ffmpeg",
          command: [
            ffmpeg,
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "avfoundation",
            "-i",
            "none:0",
            "-ac",
            "1",
            "-ar",
            "16000",
            "-c:a",
            "pcm_s16le",
            "-y",
            filePath,
          ],
        }
      }

      if (process.platform === "linux") {
        return {
          name: "ffmpeg",
          command: [
            ffmpeg,
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "pulse",
            "-i",
            "default",
            "-ac",
            "1",
            "-ar",
            "16000",
            "-c:a",
            "pcm_s16le",
            "-y",
            filePath,
          ],
        }
      }
    }

    const rec = Bun.which("rec")
    if (rec) {
      return {
        name: "rec",
        command: [rec, "-q", "-c", "1", "-r", "16000", filePath],
      }
    }

    if (process.platform === "darwin") {
      const swift = Bun.which("swift")
      const scriptPath = await ensureSwiftRecorderScriptPath()
      if (swift && scriptPath) {
        return {
          name: "swift-avfoundation",
          command: [swift, scriptPath, filePath],
        }
      }
    }

    return null
  }

  function looksLikeMicPermissionError(message: string): boolean {
    const value = message.toLowerCase()
    return (
      value.includes(SWIFT_MIC_PERMISSION_ERROR.toLowerCase()) ||
      value.includes("permission denied") ||
      value.includes("not permitted") ||
      value.includes("not authorized") ||
      value.includes("operation not permitted")
    )
  }

  function currentTerminalName(): string {
    return process.env.TERM_PROGRAM || process.env.TERMINAL_EMULATOR || process.env.TERM || "terminal"
  }

  function isLikelyIntegratedTerminal(): boolean {
    const value = currentTerminalName().toLowerCase()
    return value.includes("vscode") || value.includes("zed") || value.includes("warp") || value.includes("jetbrains")
  }

  function extractTranscriptContent(content: unknown): string {
    if (typeof content === "string") return content.trim()
    if (!Array.isArray(content)) return ""

    const merged = content
      .map((part) => {
        if (typeof part === "string") return part
        if (part && typeof part === "object" && "text" in part && typeof (part as any).text === "string") {
          return (part as any).text
        }
        return ""
      })
      .join(" ")
      .trim()

    return merged
  }

  function openRouterEndpoint(baseURL: string, endpoint: string): string {
    return `${baseURL.replace(/\/+$/, "")}${endpoint}`
  }

  function normalizeOpenRouterBaseURL(value: string | undefined): string {
    if (!value) return OPENROUTER_BASE_URL
    try {
      const parsed = new URL(value)
      if (!parsed.hostname.endsWith("openrouter.ai")) {
        return OPENROUTER_BASE_URL
      }
      return `${parsed.origin}/api/v1`
    } catch {
      return OPENROUTER_BASE_URL
    }
  }

  async function openRouterErrorDetail(response: Response): Promise<string> {
    const text = await response.text().catch(() => "")
    if (!text) return response.statusText
    try {
      const parsed = JSON.parse(text) as { error?: { message?: string }; message?: string }
      return parsed.error?.message ?? parsed.message ?? text
    } catch {
      return text
    }
  }

  async function resolveOpenRouterConfig(): Promise<{ apiKey: string; baseURL: string }> {
    const auth = await Auth.get("openrouter").catch(() => undefined)
    const providerOptions = (sync.data.config as any)?.provider?.openrouter?.options ?? {}
    const optionApiKey = typeof providerOptions.apiKey === "string" ? providerOptions.apiKey : undefined

    const apiKey =
      process.env.NIKCLI_OPENROUTER_API_KEY ??
      process.env.OPENROUTER_API_KEY ??
      (auth?.type === "api" ? auth.key : undefined) ??
      optionApiKey

    if (!apiKey || !apiKey.trim()) {
      throw new Error("OpenRouter API key not configured")
    }

    const baseURL = normalizeOpenRouterBaseURL(
      process.env.NIKCLI_OPENROUTER_BASE_URL ??
        process.env.OPENROUTER_BASE_URL ??
        (typeof providerOptions.baseURL === "string" ? providerOptions.baseURL : undefined),
    )

    return {
      apiKey: apiKey.trim(),
      baseURL,
    }
  }

  async function transcribeVoiceAudioViaResponses(
    base64Audio: string,
    config: { apiKey: string; baseURL: string },
    signal: AbortSignal,
  ): Promise<string> {
    const response = await fetch(openRouterEndpoint(config.baseURL, "/responses"), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://nikcli.store/",
        "X-Title": "nikcli",
      },
      body: JSON.stringify({
        model: process.env.NIKCLI_VOICE_TRANSCRIBE_MODEL ?? VOICE_TRANSCRIBE_MODEL,
        temperature: 0,
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: "Transcribe this audio. Return only the transcript text without extra commentary.",
              },
              {
                type: "input_audio",
                input_audio: {
                  data: base64Audio,
                  format: "wav",
                },
              },
            ],
          },
        ],
      }),
      signal,
    })

    if (!response.ok) {
      const detail = await openRouterErrorDetail(response)
      throw new Error(`OpenRouter transcription failed (${response.status}): ${detail}`)
    }

    const result = (await response.json()) as {
      output_text?: string
      output?: Array<{
        content?: Array<{
          type?: string
          text?: string
        }>
      }>
    }

    const fromOutputText = (result.output_text ?? "").trim()
    if (fromOutputText) return fromOutputText

    const fromContent =
      result.output
        ?.flatMap((x) => x.content ?? [])
        .map((x) => (x.type === "output_text" && x.text ? x.text : ""))
        .join(" ")
        .trim() ?? ""

    if (!fromContent) {
      throw new Error("No transcript returned")
    }

    return fromContent
  }

  async function transcribeVoiceAudio(filePath: string): Promise<string> {
    const audio = await Bun.file(filePath).arrayBuffer()
    if (audio.byteLength === 0) {
      throw new Error("Recorded audio is empty")
    }

    const config = await resolveOpenRouterConfig()
    const base64Audio = Buffer.from(audio).toString("base64")
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 60_000)

    try {
      const response = await fetch(openRouterEndpoint(config.baseURL, "/chat/completions"), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://nikcli.store/",
          "X-Title": "nikcli",
        },
        body: JSON.stringify({
          model: process.env.NIKCLI_VOICE_TRANSCRIBE_MODEL ?? VOICE_TRANSCRIBE_MODEL,
          temperature: 0,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: "Transcribe this audio. Return only the transcript text without extra commentary.",
                },
                {
                  type: "input_audio",
                  input_audio: {
                    data: base64Audio,
                    format: "wav",
                  },
                },
              ],
            },
          ],
        }),
        signal: controller.signal,
      })

      if (!response.ok) {
        if (response.status === 402) {
          const detail = await openRouterErrorDetail(response)
          throw new Error(`OpenRouter audio credits required: ${detail}`)
        }
        const detail = await openRouterErrorDetail(response)
        throw new Error(`OpenRouter transcription failed (${response.status}): ${detail}`)
      }

      const result = (await response.json()) as {
        choices?: Array<{
          message?: {
            content?: unknown
          }
        }>
      }

      const content = result.choices?.[0]?.message?.content
      const transcript = extractTranscriptContent(content)
      if (!transcript) {
        throw new Error("No transcript returned")
      }
      return transcript
    } catch (error) {
      const message = error instanceof Error ? error.message : ""
      if (message.includes("credits required") || message.includes("(402)")) {
        throw error
      }

      return transcribeVoiceAudioViaResponses(base64Audio, config, controller.signal)
    } finally {
      clearTimeout(timeout)
    }
  }

  let isStartingRecording = false
  async function startVoiceRecording() {
    if (voiceStatus() !== "idle") return
    if (isStartingRecording) return
    isStartingRecording = true

    try {
      const filePath = path.join(os.tmpdir(), `nikcli-voice-${Date.now()}-${Math.random().toString(16).slice(2)}.wav`)
      const recorder = await detectVoiceRecorder(filePath)

      if (!recorder) {
        toast.show({
          variant: "error",
          message:
            process.platform === "darwin"
              ? "Voice mode requires ffmpeg, sox, or macOS Command Line Tools (swift)"
              : "Voice mode requires ffmpeg or sox (rec) installed",
          duration: 4000,
        })
        return
      }

      if (!hasShownMicHint) {
        hasShownMicHint = true
        const message =
          process.platform === "darwin"
            ? "If prompted, allow microphone access for your terminal"
            : "Allow microphone access when prompted by your operating system"
        toast.show({ variant: "info", message, duration: 3500 })
      }

      try {
        voiceAudioPath = filePath
        voiceRecorder = Bun.spawn(recorder.command, {
          stdout: "ignore",
          stderr: "pipe",
        })
        voiceAutoStopTimer = setTimeout(() => {
          void stopVoiceRecording()
        }, 90_000)
        setVoiceStatus("recording")
        toast.show({
          variant: "info",
          message: `Recording started (${recorder.name}). Hold to talk, or click again to stop`,
          duration: 2500,
        })
      } catch {
        cleanupVoiceAudio(filePath)
        voiceAudioPath = null
        voiceRecorder = null
        if (voiceAutoStopTimer) {
          clearTimeout(voiceAutoStopTimer)
          voiceAutoStopTimer = undefined
        }
        setVoiceStatus("idle")
        toast.show({ variant: "error", message: "Failed to start voice recording", duration: 3000 })
      }
    } finally {
      isStartingRecording = false
    }
  }

  async function stopVoiceRecording() {
    if (!voiceRecorder || !voiceAudioPath) {
      setVoiceStatus("idle")
      return
    }

    const recorder = voiceRecorder
    const filePath = voiceAudioPath
    voiceRecorder = null
    voiceAudioPath = null
    if (voiceAutoStopTimer) {
      clearTimeout(voiceAutoStopTimer)
      voiceAutoStopTimer = undefined
    }
    setVoiceStatus("transcribing")

    try {
      try {
        recorder.kill("SIGINT")
      } catch {
        recorder.kill()
      }

      await Promise.race([recorder.exited, new Promise((resolve) => setTimeout(resolve, 4000))])

      const stderrText =
        recorder.stderr && typeof recorder.stderr !== "number"
          ? await new Response(recorder.stderr).text().catch(() => "")
          : ""
      if (looksLikeMicPermissionError(stderrText)) {
        const detail = stderrText
          .split("\n")
          .map((x) => x.trim())
          .filter(Boolean)
          .at(-1)
        const terminalName = currentTerminalName()
        const message =
          process.platform === "darwin"
            ? isLikelyIntegratedTerminal()
              ? `Microphone denied for ${terminalName}. Allow it in System Settings > Privacy & Security > Microphone, or run nikcli in Terminal.app/iTerm2`
              : `Microphone access denied for ${terminalName}. Enable it in System Settings > Privacy & Security > Microphone`
            : "Microphone access denied. Allow microphone permission for your terminal"
        toast.show({
          variant: "error",
          message: detail ? `${message} (${detail})` : message,
          duration: 8000,
        })
        return
      }

      const recordedBytes = await Bun.file(filePath)
        .arrayBuffer()
        .then((x) => x.byteLength)
        .catch(() => 0)

      if (recordedBytes < 1024) {
        const detail = stderrText.trim().split("\n").at(-1)
        toast.show({
          variant: "error",
          message: detail ? `No audio captured: ${detail}` : "No audio captured. Try holding the button longer",
          duration: 5000,
        })
        return
      }

      const transcript = await transcribeVoiceAudio(filePath)
      const withSpacing = input.plainText.length > 0 && !input.plainText.endsWith(" ") ? ` ${transcript}` : transcript
      const nextInput = `${input.plainText}${withSpacing}`

      input.focus()
      input.setText(nextInput)
      setStore("prompt", "input", nextInput)
      autocomplete.onInput(nextInput)
      await Clipboard.copy(transcript).catch(() => {})

      setTimeout(() => {
        input.cursorOffset = nextInput.length
        renderer.requestRender()
      }, 0)

      toast.show({ variant: "success", message: "Voice transcript inserted and copied", duration: 2000 })
    } catch (error) {
      const message = error instanceof Error ? error.message : "Voice transcription failed"
      toast.show({ variant: "error", message, duration: 4000 })
    } finally {
      cleanupVoiceAudio(filePath)
      setVoiceStatus("idle")
    }
  }

  async function handleVoiceButtonDown() {
    if (props.disabled) return
    if (voiceStatus() === "transcribing") return
    if (voiceStatus() === "recording") {
      await stopVoiceRecording()
      return
    }
    voicePressStartedAt = Date.now()
    await startVoiceRecording()
  }

  async function handleVoiceButtonUp() {
    if (props.disabled) return
    if (Date.now() - voicePressStartedAt < 220) return
    if (voiceStatus() !== "recording") return
    await stopVoiceRecording()
  }

  onCleanup(() => {
    if (voiceAutoStopTimer) {
      clearTimeout(voiceAutoStopTimer)
      voiceAutoStopTimer = undefined
    }
    if (voiceRecorder) {
      try {
        voiceRecorder.kill("SIGINT")
      } catch {
        try {
          voiceRecorder.kill()
        } catch {
          // ignore
        }
      }
      voiceRecorder = null
    }
    cleanupVoiceAudio(voiceAudioPath)
    voiceAudioPath = null
  })

  type BackgroundSubtasksMap = Record<string, string[]>

  function getBackgroundSubtasksMap(): BackgroundSubtasksMap {
    return (kv.get("background_subtasks", {}) ?? {}) as BackgroundSubtasksMap
  }

  function setBackgroundSubtasksMap(next: BackgroundSubtasksMap) {
    kv.set("background_subtasks", next)
  }

  function removeBackgroundSubtask(parentID: string, childID: string) {
    const map = getBackgroundSubtasksMap()
    const list = map[parentID] ?? []
    if (!list.includes(childID)) return
    setBackgroundSubtasksMap({ ...map, [parentID]: list.filter((x) => x !== childID) })
  }

  const backgroundedSubtaskIDs = createMemo(() => {
    if (!props.sessionID) return [] as string[]
    const map = getBackgroundSubtasksMap()
    return map[props.sessionID] ?? []
  })

  const backgroundedSubtaskCount = createMemo(() => backgroundedSubtaskIDs().length)

  function openBackgroundSubtasks() {
    if (!props.sessionID) return
    dialog.replace(() => <DialogSubagent sessionID={props.sessionID!} />)
  }

  function stripSubagentSuffix(title: string): string {
    return title.replace(/\s*\(@[^\s]+\s+subagent\)$/, "")
  }

  // Auto-resurface: when a backgrounded subtask finishes, reopen it in the foreground.
  const previousSubtaskStatus = new Map<string, string>()
  createEffect(() => {
    if (!props.sessionID) return

    const ids = backgroundedSubtaskIDs()
    const live = new Set(ids)
    for (const existing of previousSubtaskStatus.keys()) {
      if (!live.has(existing)) previousSubtaskStatus.delete(existing)
    }

    // Resurface the first task that transitioned to idle.
    for (const id of ids) {
      const current = sync.data.session_status?.[id]?.type ?? "idle"
      const prev = previousSubtaskStatus.get(id)
      previousSubtaskStatus.set(id, current)
      if (!prev) continue
      if (prev !== "idle" && current === "idle") {
        const title = sync.data.session.find((s) => s.id === id)?.title
        toast.show({
          variant: "success",
          message: `${stripSubagentSuffix(title ?? "Subtask")} finished`,
          duration: 3000,
        })
        removeBackgroundSubtask(props.sessionID, id)
        route.navigate({ type: "session", sessionID: id, workspaceID: sync.session.get(id)?.workspaceID })
        break
      }
    }
  })

  const getAvailableAds = () => {
    const adsConfig = ads()
    const items = (adsConfig?.items ?? []).filter((item) => item.enabled !== false)
    const enabled = adsConfig?.enabled ?? true
    if (!enabled || items.length === 0) return []
    return items
  }

  const selectNextAd = () => {
    const items = getAvailableAds()
    if (items.length === 0) {
      setCurrentAd(null)
      return
    }

    const adsConfig = ads()
    const ratio = adsConfig?.ratio ?? 0.3
    if (Math.random() >= ratio) {
      setCurrentAd(null)
      return
    }

    const index = store.currentAdIndex % items.length
    const item = items[index]
    setStore("currentAdIndex", (store.currentAdIndex + 1) % items.length)

    if (item.url) setCurrentAd(`${item.text} {highlight}${item.url}{/highlight}`)
    else setCurrentAd(item.text)
  }

  createEffect(
    on(
      () => status(),
      (currentStatus) => {
        if (currentStatus.type === "idle") {
          selectNextAd()
        }
      },
      { defer: true },
    ),
  )

  const sponsoredTip = currentAd

  const parseTipParts = (tip: string) => {
    const parts: { text: string; highlight: boolean }[] = []
    const regex = /\{highlight\}(.*?)\{\/highlight\}/g
    let lastIndex = 0
    for (const match of tip.matchAll(regex)) {
      if (match.index! > lastIndex) {
        parts.push({ text: tip.slice(lastIndex, match.index), highlight: false })
      }
      parts.push({ text: match[1], highlight: true })
      lastIndex = match.index! + match[0].length
    }
    if (lastIndex < tip.length) {
      parts.push({ text: tip.slice(lastIndex), highlight: false })
    }
    return parts
  }

  function promptModelWarning() {
    toast.show({
      variant: "warning",
      message: "Connect a provider to send prompts",
      duration: 3000,
    })
    if (sync.data.provider.length === 0) {
      dialog.replace(() => <DialogProviderConnect />)
    }
  }

  const textareaKeybindings = useTextareaKeybindings()

  const fileStyleId = syntax().getStyleId("extmark.file")!
  const agentStyleId = syntax().getStyleId("extmark.agent")!
  const pasteStyleId = syntax().getStyleId("extmark.paste")!
  let promptPartTypeId = 0

  sdk.event.on(TuiEvent.PromptAppend.type, (evt) => {
    input.insertText(evt.properties.text)
    setTimeout(() => {
      input.getLayoutNode().markDirty()
      input.gotoBufferEnd()
      renderer.requestRender()
    }, 0)
  })

  createEffect(
    on(
      () => [props.disabled, theme.backgroundElement, theme.text] as const,
      ([disabled, bg, text]) => {
        if (disabled) input.cursorColor = bg
        if (!disabled) input.cursorColor = text
      },
      { defer: true },
    ),
  )

  const lastUserMessage = createMemo(() => {
    if (!props.sessionID) return undefined
    const messages = sync.data.message[props.sessionID]
    if (!messages) return undefined
    return messages.findLast((m) => m.role === "user")
  })

  const [store, setStore] = createStore<{
    prompt: PromptInfo
    mode: "normal" | "shell"
    extmarkToPartIndex: Map<number, number>
    interrupt: number
    placeholder: number
    currentAdIndex: number
  }>({
    placeholder: Math.floor(Math.random() * PLACEHOLDERS.length),
    prompt: {
      input: "",
      parts: [],
    },
    mode: "normal",
    extmarkToPartIndex: new Map(),
    interrupt: 0,
    currentAdIndex: 0,
  })

  createEffect(
    on(
      () => props.sessionID,
      () => {
        setStore("placeholder", Math.floor(Math.random() * PLACEHOLDERS.length))
      },
      { defer: true },
    ),
  )

  // Initialize agent/model/variant from last user message when session changes
  let syncedSessionID: string | undefined
  createEffect(
    on(
      () => ({ sessionID: props.sessionID, msg: lastUserMessage() }),
      ({ sessionID, msg }) => {
        if (sessionID !== syncedSessionID) {
          if (!sessionID || !msg) return

          syncedSessionID = sessionID

          const isPrimaryAgent = local.agent.list().some((x) => x.name === msg.agent)
          if (msg.agent && isPrimaryAgent) {
            local.agent.set(msg.agent)
            if (msg.model) local.model.set(msg.model)
            if (msg.variant) local.model.variant.set(msg.variant)
          }
        }
      },
      { defer: true },
    ),
  )

  command.register(() => {
    return [
      {
        title: "Clear prompt",
        value: "prompt.clear",
        category: "Prompt",
        hidden: true,
        onSelect: (dialog) => {
          input.extmarks.clear()
          input.clear()
          dialog.clear()
        },
      },
      {
        title: "Submit prompt",
        value: "prompt.submit",
        keybind: "input_submit",
        category: "Prompt",
        hidden: true,
        onSelect: (dialog) => {
          if (!input.focused) return
          submit()
          dialog.clear()
        },
      },
      {
        title: "Paste",
        value: "prompt.paste",
        keybind: "input_paste",
        category: "Prompt",
        hidden: true,
        onSelect: async () => {
          const content = await Clipboard.read()
          if (content?.mime.startsWith("image/")) {
            await pasteImage({
              filename: "clipboard",
              mime: content.mime,
              content: content.data,
            })
          }
        },
      },
      {
        title: "Interrupt session",
        value: "session.interrupt",
        keybind: "session_interrupt",
        category: "Session",
        hidden: true,
        enabled: status().type !== "idle",
        onSelect: (dialog) => {
          if (autocomplete.visible) return
          if (!input.focused) return
          // TODO: this should be its own command
          if (store.mode === "shell") {
            setStore("mode", "normal")
            return
          }
          if (!props.sessionID) return

          setStore("interrupt", store.interrupt + 1)

          setTimeout(() => {
            setStore("interrupt", 0)
          }, 5000)

          if (store.interrupt >= 2) {
            sdk.client.session.abort({
              sessionID: props.sessionID,
            })
            setStore("interrupt", 0)
          }
          dialog.clear()
        },
      },
      {
        title: "Open editor",
        category: "Session",
        keybind: "editor_open",
        value: "prompt.editor",
        slash: {
          name: "editor",
        },
        onSelect: async (dialog) => {
          dialog.clear()

          // replace summarized text parts with the actual text
          const text = store.prompt.parts
            .filter((p) => p.type === "text")
            .reduce((acc, p) => {
              if (!p.source) return acc
              return acc.replace(p.source.text.value, p.text)
            }, store.prompt.input)

          const nonTextParts = store.prompt.parts.filter((p) => p.type !== "text")

          const value = text
          const content = await Editor.open({ value, renderer })
          if (!content) return

          input.setText(content)

          // Update positions for nonTextParts based on their location in new content
          // Filter out parts whose virtual text was deleted
          // this handles a case where the user edits the text in the editor
          // such that the virtual text moves around or is deleted
          const updatedNonTextParts = nonTextParts
            .map((part) => {
              let virtualText = ""
              if (part.type === "file" && part.source?.text) {
                virtualText = part.source.text.value
              } else if (part.type === "agent" && part.source) {
                virtualText = part.source.value
              }

              if (!virtualText) return part

              const newStart = content.indexOf(virtualText)
              // if the virtual text is deleted, remove the part
              if (newStart === -1) return null

              const newEnd = newStart + virtualText.length

              if (part.type === "file" && part.source?.text) {
                return {
                  ...part,
                  source: {
                    ...part.source,
                    text: {
                      ...part.source.text,
                      start: newStart,
                      end: newEnd,
                    },
                  },
                }
              }

              if (part.type === "agent" && part.source) {
                return {
                  ...part,
                  source: {
                    ...part.source,
                    start: newStart,
                    end: newEnd,
                  },
                }
              }

              return part
            })
            .filter((part) => part !== null)

          setStore("prompt", {
            input: content,
            // keep only the non-text parts because the text parts were
            // already expanded inline
            parts: updatedNonTextParts,
          })
          restoreExtmarksFromParts(updatedNonTextParts)
          input.cursorOffset = Bun.stringWidth(content)
        },
      },
    ]
  })

  const ref: PromptRef = {
    get focused() {
      return input.focused
    },
    get current() {
      return store.prompt
    },
    focus() {
      input.focus()
    },
    blur() {
      input.blur()
    },
    set(prompt) {
      input.setText(prompt.input)
      setStore("prompt", prompt)
      restoreExtmarksFromParts(prompt.parts)
      input.gotoBufferEnd()
    },
    reset() {
      input.clear()
      input.extmarks.clear()
      setStore("prompt", {
        input: "",
        parts: [],
      })
      setStore("extmarkToPartIndex", new Map())
    },
    submit() {
      submit()
    },
  }

  createEffect(
    on(
      () => props.visible,
      (visible) => {
        if (visible !== false) input?.focus()
        if (visible === false) input?.blur()
      },
      { defer: true },
    ),
  )

  function restoreExtmarksFromParts(parts: PromptInfo["parts"]) {
    input.extmarks.clear()
    setStore("extmarkToPartIndex", new Map())

    parts.forEach((part, partIndex) => {
      let start = 0
      let end = 0
      let virtualText = ""
      let styleId: number | undefined

      if (part.type === "file" && part.source?.text) {
        start = part.source.text.start
        end = part.source.text.end
        virtualText = part.source.text.value
        styleId = fileStyleId
      } else if (part.type === "agent" && part.source) {
        start = part.source.start
        end = part.source.end
        virtualText = part.source.value
        styleId = agentStyleId
      } else if (part.type === "text" && part.source?.text) {
        start = part.source.text.start
        end = part.source.text.end
        virtualText = part.source.text.value
        styleId = pasteStyleId
      }

      if (virtualText) {
        const extmarkId = input.extmarks.create({
          start,
          end,
          virtual: true,
          styleId,
          typeId: promptPartTypeId,
        })
        setStore("extmarkToPartIndex", (map: Map<number, number>) => {
          const newMap = new Map(map)
          newMap.set(extmarkId, partIndex)
          return newMap
        })
      }
    })
  }

  function syncExtmarksWithPromptParts() {
    const allExtmarks = input.extmarks.getAllForTypeId(promptPartTypeId)
    setStore(
      produce((draft) => {
        const newMap = new Map<number, number>()
        const newParts: typeof draft.prompt.parts = []

        for (const extmark of allExtmarks) {
          const partIndex = draft.extmarkToPartIndex.get(extmark.id)
          if (partIndex !== undefined) {
            const part = draft.prompt.parts[partIndex]
            if (part) {
              if (part.type === "agent" && part.source) {
                part.source.start = extmark.start
                part.source.end = extmark.end
              } else if (part.type === "file" && part.source?.text) {
                part.source.text.start = extmark.start
                part.source.text.end = extmark.end
              } else if (part.type === "text" && part.source?.text) {
                part.source.text.start = extmark.start
                part.source.text.end = extmark.end
              }
              newMap.set(extmark.id, newParts.length)
              newParts.push(part)
            }
          }
        }

        draft.extmarkToPartIndex = newMap
        draft.prompt.parts = newParts
      }),
    )
  }

  command.register(() => [
    {
      title: "Stash prompt",
      value: "prompt.stash",
      category: "Prompt",
      enabled: !!store.prompt.input,
      onSelect: (dialog) => {
        if (!store.prompt.input) return
        stash.push({
          input: store.prompt.input,
          parts: store.prompt.parts,
        })
        input.extmarks.clear()
        input.clear()
        setStore("prompt", { input: "", parts: [] })
        setStore("extmarkToPartIndex", new Map())
        dialog.clear()
      },
    },
    {
      title: "Stash pop",
      value: "prompt.stash.pop",
      category: "Prompt",
      enabled: stash.list().length > 0,
      onSelect: (dialog) => {
        const entry = stash.pop()
        if (entry) {
          input.setText(entry.input)
          setStore("prompt", { input: entry.input, parts: entry.parts })
          restoreExtmarksFromParts(entry.parts)
          input.gotoBufferEnd()
        }
        dialog.clear()
      },
    },
    {
      title: "Stash list",
      value: "prompt.stash.list",
      category: "Prompt",
      enabled: stash.list().length > 0,
      onSelect: (dialog) => {
        dialog.replace(() => (
          <DialogStash
            onSelect={(entry) => {
              input.setText(entry.input)
              setStore("prompt", { input: entry.input, parts: entry.parts })
              restoreExtmarksFromParts(entry.parts)
              input.gotoBufferEnd()
            }}
          />
        ))
      },
    },
  ])

  command.register(() => [
    {
      title: "Create Theme",
      value: "theme.create",
      category: "Theme",
      slash: { name: "theme-create" },
      onSelect: (dialog) => {
        dialog.replace(() => <DialogThemeCreate />)
      },
    },
    {
      title: "RAG Embedding Models",
      value: "rag-model",
      category: "Config",
      slash: { name: "rag-models", aliases: ["rag-model"] },
      onSelect: (dialog) => {
        dialog.replace(() => <DialogRagModel />)
      },
    },
    {
      title: "Image Models",
      value: "image-models",
      category: "Config",
      slash: { name: "image-models" },
      onSelect: (dialog) => {
        dialog.replace(() => <DialogImageModel />)
      },
    },
    {
      title: "TTS Voice",
      value: "speak-model",
      category: "Config",
      slash: { name: "speak-model" },
      onSelect: (dialog) => {
        dialog.replace(() => <DialogSpeakModel />)
      },
    },
    {
      title: "Remote Access",
      value: "remote",
      category: "Config",
      slash: { name: "remote" },
      onSelect: (dialog) => {
        dialog.replace(() => <DialogRemote />)
      },
    },
  ])

  async function submit() {
    if (props.disabled) return
    if (autocomplete?.visible) return
    if (!store.prompt.input) return
    const trimmed = store.prompt.input.trim()
    if (trimmed === "exit" || trimmed === "quit" || trimmed === ":q") {
      exit()
      return
    }
    const selectedModel = local.model.current()
    if (!selectedModel) {
      promptModelWarning()
      return
    }
    const sessionID = props.sessionID
      ? props.sessionID
      : await (async () => {
          const sessionID = await sdk.client.session.create({ workspaceID: props.workspaceID }).then((x) => x.data!.id)
          return sessionID
        })()
    const messageID = Identifier.ascending("message")
    let inputText = store.prompt.input

    // Expand pasted text inline before submitting
    const allExtmarks = input.extmarks.getAllForTypeId(promptPartTypeId)
    const sortedExtmarks = allExtmarks.sort((a: { start: number }, b: { start: number }) => b.start - a.start)

    for (const extmark of sortedExtmarks) {
      const partIndex = store.extmarkToPartIndex.get(extmark.id)
      if (partIndex !== undefined) {
        const part = store.prompt.parts[partIndex]
        if (part?.type === "text" && part.text) {
          const before = inputText.slice(0, extmark.start)
          const after = inputText.slice(extmark.end)
          inputText = before + part.text + after
        }
      }
    }

    // Filter out text parts (pasted content) since they're now expanded inline
    const nonTextParts = store.prompt.parts.filter((part) => part.type !== "text")

    // Capture mode before it gets reset
    const currentMode = store.mode
    const variant = local.model.variant.current()

    if (store.mode === "shell") {
      sdk.client.session.shell({
        sessionID,
        agent: local.agent.current().name,
        model: {
          providerID: selectedModel.providerID,
          modelID: selectedModel.modelID,
        },
        command: inputText,
      })
      setStore("mode", "normal")
    } else if (
      inputText.startsWith("/") &&
      iife(() => {
        const firstLine = inputText.split("\n")[0]
        const command = firstLine.split(" ")[0].slice(1)
        return sync.data.command.some((x) => x.name === command)
      })
    ) {
      // Parse command from first line, preserve multi-line content in arguments
      const firstLineEnd = inputText.indexOf("\n")
      const firstLine = firstLineEnd === -1 ? inputText : inputText.slice(0, firstLineEnd)
      const [command, ...firstLineArgs] = firstLine.split(" ")
      const restOfInput = firstLineEnd === -1 ? "" : inputText.slice(firstLineEnd + 1)
      const args = firstLineArgs.join(" ") + (restOfInput ? "\n" + restOfInput : "")

      sdk.client.session.command({
        sessionID,
        command: command.slice(1),
        arguments: args,
        agent: local.agent.current().name,
        model: `${selectedModel.providerID}/${selectedModel.modelID}`,
        messageID,
        variant,
        parts: nonTextParts
          .filter((x) => x.type === "file")
          .map((x) => ({
            id: Identifier.ascending("part"),
            ...x,
          })),
      })
    } else {
      sdk.client.session
        .prompt({
          sessionID,
          ...selectedModel,
          messageID,
          agent: local.agent.current().name,
          model: selectedModel,
          variant,
          parts: [
            {
              id: Identifier.ascending("part"),
              type: "text",
              text: inputText,
            },
            ...nonTextParts.map((x) => ({
              id: Identifier.ascending("part"),
              ...x,
            })),
          ],
        })
        .catch(() => {})
    }
    history.append({
      ...store.prompt,
      mode: currentMode,
    })
    input.extmarks.clear()
    setStore("prompt", {
      input: "",
      parts: [],
    })
    setStore("extmarkToPartIndex", new Map())
    props.onSubmit?.()

    // temporary hack to make sure the message is sent
    if (!props.sessionID)
      setTimeout(() => {
        route.navigate({
          type: "session",
          sessionID,
          workspaceID: props.workspaceID ?? sync.session.get(sessionID)?.workspaceID,
        })
      }, 50)
    input.clear()
  }
  const exit = useExit()

  function pasteText(text: string, virtualText: string) {
    const currentOffset = input.visualCursor.offset
    const extmarkStart = currentOffset
    const extmarkEnd = extmarkStart + virtualText.length

    input.insertText(virtualText + " ")

    const extmarkId = input.extmarks.create({
      start: extmarkStart,
      end: extmarkEnd,
      virtual: true,
      styleId: pasteStyleId,
      typeId: promptPartTypeId,
    })

    setStore(
      produce((draft) => {
        const partIndex = draft.prompt.parts.length
        draft.prompt.parts.push({
          type: "text" as const,
          text,
          source: {
            text: {
              start: extmarkStart,
              end: extmarkEnd,
              value: virtualText,
            },
          },
        })
        draft.extmarkToPartIndex.set(extmarkId, partIndex)
      }),
    )
  }

  async function pasteImage(file: { filename?: string; content: string; mime: string }) {
    const currentOffset = input.visualCursor.offset
    const extmarkStart = currentOffset
    const count = store.prompt.parts.filter((x) => x.type === "file").length
    const virtualText = `[Image ${count + 1}]`
    const extmarkEnd = extmarkStart + virtualText.length
    const textToInsert = virtualText + " "

    input.insertText(textToInsert)

    const extmarkId = input.extmarks.create({
      start: extmarkStart,
      end: extmarkEnd,
      virtual: true,
      styleId: pasteStyleId,
      typeId: promptPartTypeId,
    })

    const part: Omit<FilePart, "id" | "messageID" | "sessionID"> = {
      type: "file" as const,
      mime: file.mime,
      filename: file.filename,
      url: `data:${file.mime};base64,${file.content}`,
      source: {
        type: "file",
        path: file.filename ?? "",
        text: {
          start: extmarkStart,
          end: extmarkEnd,
          value: virtualText,
        },
      },
    }
    setStore(
      produce((draft) => {
        const partIndex = draft.prompt.parts.length
        draft.prompt.parts.push(part)
        draft.extmarkToPartIndex.set(extmarkId, partIndex)
      }),
    )
    return
  }

  const highlight = createMemo(() => {
    if (keybind.leader) return theme.border
    if (store.mode === "shell") return theme.primary
    return local.agent.color(local.agent.current().name)
  })

  const showVariant = createMemo(() => {
    const variants = local.model.variant.list()
    if (variants.length === 0) return false
    const current = local.model.variant.current()
    return !!current
  })

  const spinnerDef = createMemo(() => {
    const style = kv.get("settings.spinner.style", "knight_rider_blocks") as SpinnerStyle
    const enabled = kv.get("settings.spinner.enabled", true)

    if (!enabled) {
      return null
    }

    const color = local.agent.color(local.agent.current().name)

    const brailleFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
    const dotsFrames = ["·", "⠂", "⠄", "⠆", "⠖", "⠗", "⠞", "⠟", "⠿", "⠛"]
    const lineFrames = ["│", "⠐", "⠔", "⠤", "⠄", "⠦"]
    const bouncingFrames = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧"]
    const pulseFrames = ["▖", "▗", "▘", "▙", "▚", "▛", "▜", "▝", "▞", "▟"]

    if (style === "knight_rider_blocks") {
      return {
        frames: createFrames({
          color,
          style: "blocks",
          inactiveFactor: 0.6,
          minAlpha: 0.3,
        }),
        color: createColors({
          color,
          style: "blocks",
          inactiveFactor: 0.6,
          minAlpha: 0.3,
        }),
      }
    }

    if (style === "knight_rider_diamonds") {
      return {
        frames: createFrames({
          color,
          style: "diamonds",
          inactiveFactor: 0.6,
          minAlpha: 0.3,
        }),
        color: createColors({
          color,
          style: "diamonds",
          inactiveFactor: 0.6,
          minAlpha: 0.3,
        }),
      }
    }

    if (style === "braille") {
      return {
        frames: brailleFrames,
        color: undefined,
      }
    }

    if (style === "dots") {
      return {
        frames: dotsFrames,
        color: undefined,
      }
    }

    if (style === "line") {
      return {
        frames: lineFrames,
        color: undefined,
      }
    }

    if (style === "bouncing") {
      return {
        frames: bouncingFrames,
        color: undefined,
      }
    }

    if (style === "pulse") {
      return {
        frames: pulseFrames,
        color: undefined,
      }
    }

    // Default fallback
    return {
      frames: createFrames({
        color,
        style: "blocks",
        inactiveFactor: 0.6,
        minAlpha: 0.3,
      }),
      color: createColors({
        color,
        style: "blocks",
        inactiveFactor: 0.6,
        minAlpha: 0.3,
      }),
    }
  })

  const placeholderText = createMemo(() => {
    if (props.sessionID) return undefined
    if (store.mode === "shell") {
      const example = SHELL_PLACEHOLDERS[store.placeholder % SHELL_PLACEHOLDERS.length]
      return `Run a command... "${example}"`
    }
    return `Ask anything... "${PLACEHOLDERS[store.placeholder % PLACEHOLDERS.length]}"`
  })

  return (
    <>
      <Autocomplete
        sessionID={props.sessionID}
        ref={(r) => (autocomplete = r)}
        anchor={() => anchor}
        input={() => input}
        setPrompt={(cb) => {
          setStore("prompt", produce(cb))
        }}
        setExtmark={(partIndex, extmarkId) => {
          setStore("extmarkToPartIndex", (map: Map<number, number>) => {
            const newMap = new Map(map)
            newMap.set(extmarkId, partIndex)
            return newMap
          })
        }}
        value={store.prompt.input}
        fileStyleId={fileStyleId}
        agentStyleId={agentStyleId}
        promptPartTypeId={() => promptPartTypeId}
      />
      <box ref={(r) => (anchor = r)} visible={props.visible !== false}>
        <box
          border={["left"]}
          borderColor={highlight()}
          customBorderChars={{
            ...EmptyBorder,
            vertical: "┃",
            bottomLeft: "╹",
          }}
        >
          <box
            paddingLeft={2}
            paddingRight={2}
            paddingTop={1}
            flexShrink={0}
            backgroundColor={theme.backgroundElement}
            flexGrow={1}
          >
            <textarea
              placeholder={placeholderText()}
              textColor={keybind.leader ? theme.textMuted : theme.text}
              focusedTextColor={keybind.leader ? theme.textMuted : theme.text}
              minHeight={1}
              maxHeight={6}
              onContentChange={() => {
                const value = input.plainText
                setStore("prompt", "input", value)
                autocomplete.onInput(value)
                syncExtmarksWithPromptParts()
              }}
              keyBindings={textareaKeybindings()}
              onKeyDown={async (e) => {
                if (props.disabled) {
                  e.preventDefault()
                  return
                }
                // Handle clipboard paste (Ctrl+V) - check for images first on Windows
                // This is needed because Windows terminal doesn't properly send image data
                // through bracketed paste, so we need to intercept the keypress and
                // directly read from clipboard before the terminal handles it
                if (keybind.match("input_paste", e)) {
                  const content = await Clipboard.read()
                  if (content?.mime.startsWith("image/")) {
                    e.preventDefault()
                    await pasteImage({
                      filename: "clipboard",
                      mime: content.mime,
                      content: content.data,
                    })
                    return
                  }
                  // If no image, let the default paste behavior continue
                }

                if (keybind.match("input_clear", e) && store.prompt.input !== "") {
                  input.clear()
                  input.extmarks.clear()
                  setStore("prompt", {
                    input: "",
                    parts: [],
                  })
                  setStore("extmarkToPartIndex", new Map())
                  return
                }
                if (keybind.match("app_exit", e)) {
                  if (store.prompt.input === "") {
                    await exit()
                    // Don't preventDefault - let textarea potentially handle the event
                    e.preventDefault()
                    return
                  }
                }

                // Background subtasks picker (Down arrow when prompt is empty)
                if (
                  !autocomplete.visible &&
                  store.mode === "normal" &&
                  props.sessionID &&
                  store.prompt.input === "" &&
                  backgroundedSubtaskCount() > 0 &&
                  keybind.match("subtask_picker", e)
                ) {
                  e.preventDefault()
                  openBackgroundSubtasks()
                  return
                }
                if (e.name === "!" && input.visualCursor.offset === 0) {
                  setStore("placeholder", Math.floor(Math.random() * SHELL_PLACEHOLDERS.length))
                  setStore("mode", "shell")
                  e.preventDefault()
                  return
                }
                if (store.mode === "shell") {
                  if ((e.name === "backspace" && input.visualCursor.offset === 0) || e.name === "escape") {
                    setStore("mode", "normal")
                    e.preventDefault()
                    return
                  }
                }
                if (store.mode === "normal") autocomplete.onKeyDown(e)
                if (!autocomplete.visible) {
                  if (
                    (keybind.match("history_previous", e) && input.cursorOffset === 0) ||
                    (keybind.match("history_next", e) && input.cursorOffset === input.plainText.length)
                  ) {
                    const direction = keybind.match("history_previous", e) ? -1 : 1
                    const item = history.move(direction, input.plainText)

                    if (item) {
                      input.setText(item.input)
                      setStore("prompt", item)
                      setStore("mode", item.mode ?? "normal")
                      restoreExtmarksFromParts(item.parts)
                      e.preventDefault()
                      if (direction === -1) input.cursorOffset = 0
                      if (direction === 1) input.cursorOffset = input.plainText.length
                    }
                    return
                  }

                  if (keybind.match("history_previous", e) && input.visualCursor.visualRow === 0) input.cursorOffset = 0
                  if (keybind.match("history_next", e) && input.visualCursor.visualRow === input.height - 1)
                    input.cursorOffset = input.plainText.length

                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  if (keybind.match("voice_record" as any, e)) {
                    e.preventDefault()
                    void handleVoiceButtonDown()
                    return
                  }
                }
              }}
              onSubmit={submit}
              onPaste={async (event: PasteEvent) => {
                if (props.disabled) {
                  event.preventDefault()
                  return
                }

                // Normalize line endings at the boundary
                // Windows ConPTY/Terminal often sends CR-only newlines in bracketed paste
                // Replace CRLF first, then any remaining CR
                const normalizedText = event.text.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
                const pastedContent = normalizedText.trim()
                if (!pastedContent) {
                  command.trigger("prompt.paste")
                  return
                }

                // trim ' from the beginning and end of the pasted content. just
                // ' and nothing else
                const filepath = pastedContent.replace(/^'+|'+$/g, "").replace(/\\ /g, " ")
                const isUrl = /^(https?):\/\//.test(filepath)
                if (!isUrl) {
                  try {
                    const file = Bun.file(filepath)
                    // Handle SVG as raw text content, not as base64 image
                    if (file.type === "image/svg+xml") {
                      event.preventDefault()
                      const content = await file.text().catch(() => {})
                      if (content) {
                        pasteText(content, `[SVG: ${file.name ?? "image"}]`)
                        return
                      }
                    }
                    if (file.type.startsWith("image/")) {
                      event.preventDefault()
                      const content = await file
                        .arrayBuffer()
                        .then((buffer) => Buffer.from(buffer).toString("base64"))
                        .catch(() => {})
                      if (content) {
                        await pasteImage({
                          filename: file.name,
                          mime: file.type,
                          content,
                        })
                        return
                      }
                    }
                  } catch {}
                }

                const lineCount = (pastedContent.match(/\n/g)?.length ?? 0) + 1
                if (
                  (lineCount >= 3 || pastedContent.length > 150) &&
                  !sync.data.config.experimental?.disable_paste_summary
                ) {
                  event.preventDefault()
                  pasteText(pastedContent, `[Pasted ~${lineCount} lines]`)
                  return
                }

                // Force layout update and render for the pasted content
                setTimeout(() => {
                  input.getLayoutNode().markDirty()
                  renderer.requestRender()
                }, 0)
              }}
              ref={(r: TextareaRenderable) => {
                input = r
                if (promptPartTypeId === 0) {
                  promptPartTypeId = input.extmarks.registerType("prompt-part")
                }
                props.ref?.(ref)
                setTimeout(() => {
                  input.cursorColor = theme.text
                }, 0)
              }}
              onMouseDown={(r: MouseEvent) => r.target?.focus()}
              focusedBackgroundColor={theme.backgroundElement}
              cursorColor={theme.text}
              syntaxStyle={syntax()}
            />
            <box flexDirection="row" flexShrink={0} paddingTop={1} gap={1}>
              <Show when={kv.get("show_agent", true)}>
                <text fg={highlight()}>
                  {store.mode === "shell" ? "Shell" : Locale.titlecase(local.agent.current().name)}{" "}
                </text>
              </Show>
              <Show when={store.mode === "normal" && kv.get("show_model", true)}>
                <box flexDirection="row" gap={1}>
                  <text flexShrink={0} fg={keybind.leader ? theme.textMuted : theme.text}>
                    {local.model.parsed().model}
                  </text>
                  <text fg={theme.textMuted}>{local.model.parsed().provider}</text>
                  <Show when={showVariant()}>
                    <text fg={theme.textMuted}>·</text>
                    <text>
                      <span style={{ fg: theme.warning, bold: true }}>{local.model.variant.current()}</span>
                    </text>
                  </Show>
                </box>
              </Show>
            </box>
          </box>
        </box>
        <box
          height={1}
          border={["left"]}
          borderColor={highlight()}
          customBorderChars={{
            ...EmptyBorder,
            vertical: theme.backgroundElement.a !== 0 ? "╹" : " ",
          }}
        >
          <box
            height={1}
            border={["bottom"]}
            borderColor={theme.backgroundElement}
            customBorderChars={
              theme.backgroundElement.a !== 0
                ? {
                    ...EmptyBorder,
                    horizontal: "▀",
                  }
                : {
                    ...EmptyBorder,
                    horizontal: " ",
                  }
            }
          />
        </box>
        <box flexDirection="row" justifyContent="space-between">
          <Show
            when={status().type !== "idle"}
            fallback={
              <box flexDirection="row" gap={2} flexGrow={1}>
                <Show when={props.sessionID && backgroundedSubtaskCount() > 0}>
                  <box
                    onMouseUp={() => openBackgroundSubtasks()}
                    backgroundColor={theme.primary}
                    paddingLeft={1}
                    paddingRight={1}
                    flexShrink={0}
                  >
                    <text fg={theme.background}>
                      <span style={{ bold: true }}>{backgroundedSubtaskCount()}</span> subtasks
                    </text>
                  </box>
                </Show>
                <text fg={theme.text}>
                  esc <span style={{ fg: theme.textMuted }}>interrupt</span>
                </text>
                <Show when={sponsoredTip() && kv.get("show_sponsored", true)}>
                  <text fg={theme.warning}>·</text>
                  <text fg={theme.textMuted}>Sponsored:</text>
                  <text fg={theme.text}>
                    <For each={parseTipParts(sponsoredTip()!)}>
                      {(part) => <span style={{ fg: part.highlight ? theme.text : theme.textMuted }}>{part.text}</span>}
                    </For>
                  </text>
                </Show>
              </box>
            }
          >
            <box
              flexDirection="row"
              gap={1}
              flexGrow={1}
              justifyContent={status().type === "retry" ? "space-between" : "flex-start"}
            >
              <box flexShrink={0} flexDirection="row" gap={1}>
                <box marginLeft={1}>
                  <Show
                    when={kv.get("animations_enabled", true) && spinnerDef()}
                    fallback={<text fg={theme.textMuted}>[⋯]</text>}
                  >
                    <spinner color={spinnerDef()!.color} frames={spinnerDef()!.frames} interval={40} />
                  </Show>
                </box>
                <box flexDirection="row" gap={1} flexShrink={0}>
                  {(() => {
                    const retry = createMemo(() => {
                      const s = status()
                      if (s.type !== "retry") return
                      return s
                    })
                    const message = createMemo(() => {
                      const r = retry()
                      if (!r) return
                      if (r.message.includes("exceeded your current quota") && r.message.includes("gemini"))
                        return "gemini is way too hot right now"
                      if (r.message.length > 80) return r.message.slice(0, 80) + "..."
                      return r.message
                    })
                    const isTruncated = createMemo(() => {
                      const r = retry()
                      if (!r) return false
                      return r.message.length > 120
                    })
                    const [seconds, setSeconds] = createSignal(0)
                    onMount(() => {
                      const timer = setInterval(() => {
                        const next = retry()?.next
                        if (next) setSeconds(Math.round((next - Date.now()) / 1000))
                      }, 1000)

                      onCleanup(() => {
                        clearInterval(timer)
                      })
                    })
                    const handleMessageClick = () => {
                      const r = retry()
                      if (!r) return
                      if (isTruncated()) {
                        DialogAlert.show(dialog, "Retry Error", r.message)
                      }
                    }

                    const retryText = () => {
                      const r = retry()
                      if (!r) return ""
                      const baseMessage = message()
                      const truncatedHint = isTruncated() ? " (click to expand)" : ""
                      const duration = formatDuration(seconds())
                      const retryInfo = ` [retrying ${duration ? `in ${duration} ` : ""}attempt #${r.attempt}]`
                      return baseMessage + truncatedHint + retryInfo
                    }

                    return (
                      <Show when={retry()}>
                        <box onMouseUp={handleMessageClick}>
                          <text fg={theme.error}>{retryText()}</text>
                        </box>
                      </Show>
                    )
                  })()}
                </box>
              </box>
              <box flexDirection="row" gap={2} flexGrow={1}>
                <Show when={props.sessionID && backgroundedSubtaskCount() > 0}>
                  <box
                    onMouseUp={() => openBackgroundSubtasks()}
                    backgroundColor={theme.primary}
                    paddingLeft={1}
                    paddingRight={1}
                    flexShrink={0}
                  >
                    <text fg={theme.background}>
                      <span style={{ bold: true }}>{backgroundedSubtaskCount()}</span> subtasks
                    </text>
                  </box>
                </Show>
                <text fg={store.interrupt > 0 ? theme.primary : theme.text}>
                  esc{" "}
                  <span style={{ fg: store.interrupt > 0 ? theme.primary : theme.textMuted }}>
                    {store.interrupt > 0 ? "again to interrupt" : "interrupt"}
                  </span>
                </text>
                <Show when={sponsoredTip() && kv.get("show_sponsored", true)}>
                  <text fg={theme.warning}>·</text>
                  <text fg={theme.textMuted}>Sponsored:</text>
                  <text fg={theme.text}>
                    <For each={parseTipParts(sponsoredTip()!)}>
                      {(part) => <span style={{ fg: part.highlight ? theme.text : theme.textMuted }}>{part.text}</span>}
                    </For>
                  </text>
                </Show>
              </box>
            </box>
          </Show>
          <Show when={status().type !== "retry"}>
            <box gap={2} flexDirection="row">
              <box
                onMouseDown={() => {
                  void handleVoiceButtonDown()
                }}
                onMouseUp={() => {
                  void handleVoiceButtonUp()
                }}
                backgroundColor={theme.error}
                paddingLeft={1}
                paddingRight={1}
                flexShrink={0}
              >
                <text fg={theme.background}>
                  <span style={{ bold: voiceStatus() === "recording" }}>
                    {voiceStatus() === "recording"
                      ? "release to send"
                      : voiceStatus() === "transcribing"
                        ? "transcribing..."
                        : (() => {
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            const shortcut = keybind.print("voice_record" as any)
                            return shortcut ? (
                              <>
                                ⏺ <span style={{ fg: theme.textMuted }}>rec</span>
                              </>
                            ) : (
                              "⏺"
                            )
                          })()}
                  </span>
                </text>
              </box>

              <Show when={kv.get("show_shortcuts", true)}>
                <box gap={2} flexDirection="row">
                  <Switch>
                    <Match when={store.mode === "normal"}>
                      <Show when={local.model.variant.list().length > 0}>
                        <text fg={theme.text}>
                          {keybind.print("variant_cycle")} <span style={{ fg: theme.textMuted }}>variants</span>
                        </text>
                      </Show>
                      <text fg={theme.text}>
                        {keybind.print("agent_cycle")} <span style={{ fg: theme.textMuted }}>agents</span>
                      </text>
                      <text fg={theme.text}>
                        {keybind.print("command_list")} <span style={{ fg: theme.textMuted }}>commands</span>
                      </text>
                    </Match>
                    <Match when={store.mode === "shell"}>
                      <text fg={theme.text}>
                        esc <span style={{ fg: theme.textMuted }}>exit shell mode</span>
                      </text>
                    </Match>
                  </Switch>
                </box>
              </Show>
            </box>
          </Show>
        </box>
      </box>
    </>
  )
}
