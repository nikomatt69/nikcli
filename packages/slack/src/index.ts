import { App, Assistant, type SayFn } from "@slack/bolt"
import {
  createNikcli,
  createNikcliClient,
  type Part,
  type TextPart,
  type ToolPart,
  type ToolStateCompleted,
} from "@nikcli-ai/sdk"
import { ChannelMemory } from "./channel-memory"
import { ChannelTools } from "./channel-tools"
import { FollowUps } from "./followups"

const NIKCLI_MODEL = process.env.NIKCLI_MODEL ?? "minimax-coding-plan/MiniMax-M2.5"
const allowedChannels = new Set((process.env.SLACK_ALLOWED_CHANNELS ?? "").split(/[\s,]+/).filter(Boolean))
const taskNotificationsEnabled =
  process.env.NIKCLI_SLACK_TASK_NOTIFICATIONS !== "false" &&
  process.env.SLACK_TASK_NOTIFICATIONS !== "false" &&
  process.env.SLACK_TASK_NOTIFICATIONS !== "0"
const rateLimitPerUser = Math.max(1, Number(process.env.SLACK_RATE_LIMIT_PER_USER ?? "2000"))
const BOT_USERNAME = process.env.SLACK_USERNAME
const botUsernameOpts = BOT_USERNAME ? { username: BOT_USERNAME } : {}
const RATE_WINDOW_MS = 60_000

// Parse model once
const [providerID, ...modelParts] = NIKCLI_MODEL.split("/")
const modelID = modelParts.join("/")
const modelBody = providerID && modelID ? { model: { providerID, modelID } } : {}

// Working repository the agent operates on (the entrypoint clones it here).
// When unset (local dev), nikcli falls back to its own cwd.
const WORKDIR = process.env.NIKCLI_WORKDIR
const dirQuery = WORKDIR ? { directory: WORKDIR } : undefined

type Session = { sessionId: string; channel: string; thread: string }

type SlackFile = {
  id: string
  filetype?: string
  name?: string
  mimetype?: string
  url_private?: string
}

type SlackMessage = {
  channel: string
  ts: string
  thread_ts?: string
  text?: string
  subtype?: string
  channel_type?: string
  user?: string
  files?: SlackFile[]
}

// Streaming state: track live text parts per active session
type StreamState = {
  channel: string
  ts: string
  partTexts: Map<string, string>
  timer: ReturnType<typeof setTimeout> | null
}
const activeStreams = new Map<string, StreamState>()

function scheduleStreamFlush(sessionId: string): void {
  const s = activeStreams.get(sessionId)
  if (!s) return
  if (s.timer) clearTimeout(s.timer)
  s.timer = setTimeout(() => {
    const current = activeStreams.get(sessionId)
    if (!current) return
    const text = [...current.partTexts.values()].join("\n").trim()
    if (!text) return
    app.client.chat
      .update({ channel: current.channel, ts: current.ts, text: formatForSlack(text) + " ▋" })
      .catch(() => {})
  }, 600)
}

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN,
})

console.log("Bot configuration:")
console.log("- Bot token present:", !!process.env.SLACK_BOT_TOKEN)
console.log("- Signing secret present:", !!process.env.SLACK_SIGNING_SECRET)
console.log("- App token present:", !!process.env.SLACK_APP_TOKEN)
console.log("- Model:", NIKCLI_MODEL)
console.log("- Allowed channels:", allowedChannels.size > 0 ? [...allowedChannels].join(", ") : "all")
console.log("- Task notifications:", taskNotificationsEnabled)
console.log("- Rate limit:", rateLimitPerUser, "req/min")

const NIKCLI_URL = process.env.NIKCLI_URL

let nikcli: { client: ReturnType<typeof createNikcliClient>; server: { url: string; close(): void } }

if (NIKCLI_URL) {
  console.log(`Connecting to remote nikcli server: ${NIKCLI_URL}`)
  const client = createNikcliClient({ baseUrl: NIKCLI_URL })
  nikcli = { client, server: { url: NIKCLI_URL, close() {} } }
  console.log("Nikcli remote server ready")
} else {
  console.log("Starting local nikcli server...")
  nikcli = await createNikcli({
    port: 0,
    timeout: Number(process.env.NIKCLI_START_TIMEOUT_MS ?? "120000"),
    config: { model: NIKCLI_MODEL },
  })
  console.log("Nikcli server ready")
}

// Whisper: model format is "openrouter/openai/whisper-1" (provider/subprovider/model)
const WHISPER_MODEL = process.env.WHISPER_MODEL ?? "openrouter/openai/whisper-1"
const [whisperProvider, ...whisperModelParts] = WHISPER_MODEL.split("/")
const WHISPER_API_MODEL = whisperModelParts.join("/") || "openai/whisper-1"
const WHISPER_ENDPOINT =
  whisperProvider === "openrouter"
    ? "https://openrouter.ai/api/v1/audio/transcriptions"
    : "https://api.openai.com/v1/audio/transcriptions"
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY
const WHISPER_LANGUAGE = process.env.WHISPER_LANGUAGE
const SESSIONS_FILE = process.env.SESSIONS_FILE ?? "/tmp/slack-sessions.json"
const PROCESSING_FILES = new Set<string>()
const AUDIO_EXTENSIONS = [".mp3", ".ogg", ".wav", ".m4a", ".webm", ".mp4", ".flac", ".aac"]

type PersistedSession = Session & { createdAt: number }

const sessions = new Map<string, PersistedSession>()
const SESSION_TTL_MS = 60 * 60 * 1000
const SESSION_CLEANUP_INTERVAL_MS = 5 * 60 * 1000

// Load persisted sessions from disk on startup
try {
  const raw = await Bun.file(SESSIONS_FILE).text()
  const parsed = JSON.parse(raw) as Record<string, PersistedSession>
  const now = Date.now()
  for (const [key, s] of Object.entries(parsed)) {
    if (now - s.createdAt < SESSION_TTL_MS) sessions.set(key, s)
  }
  console.log(`Loaded ${sessions.size} sessions from disk`)
} catch {
  // file doesn't exist yet — fresh start
}

// Per-channel memory + tool policy + autonomous follow-ups
await ChannelMemory.init()
await ChannelTools.init()
FollowUps.configure({
  post: async (channel, thread, text) => {
    await app.client.chat
      .postMessage({ channel, thread_ts: thread, text: formatForSlack(text), ...botUsernameOpts })
      .catch((err) => console.error("Follow-up post failed:", err))
  },
})

let persistTimer: ReturnType<typeof setTimeout> | null = null
async function persistSessions(): Promise<void> {
  try {
    const obj: Record<string, PersistedSession> = {}
    for (const [k, v] of sessions.entries()) obj[k] = v
    await Bun.write(SESSIONS_FILE, JSON.stringify(obj))
  } catch (err) {
    console.error("Failed to persist sessions:", err)
  }
}

function schedulePersist(): void {
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    persistTimer = null
    persistSessions()
  }, 2000)
}

const userRateLimit = new Map<string, number[]>()

// Unified cleanup interval: sessions + rate limit
setInterval(() => {
  const now = Date.now()
  let sessionsChanged = false
  for (const [key, s] of sessions.entries()) {
    if (now - s.createdAt > SESSION_TTL_MS) {
      sessions.delete(key)
      sessionsChanged = true
    }
  }
  if (sessionsChanged) schedulePersist()

  for (const [userId, timestamps] of userRateLimit.entries()) {
    const valid = timestamps.filter((t) => now - t < RATE_WINDOW_MS)
    if (valid.length === 0) userRateLimit.delete(userId)
    else if (valid.length !== timestamps.length) userRateLimit.set(userId, valid)
  }
}, SESSION_CLEANUP_INTERVAL_MS)

// No lock needed: critical section is synchronous, JS event loop can't interleave
function isRateLimited(userId: string): boolean {
  const now = Date.now()
  const timestamps = (userRateLimit.get(userId) ?? []).filter((t) => now - t < RATE_WINDOW_MS)
  if (timestamps.length >= rateLimitPerUser) return true
  timestamps.push(now)
  userRateLimit.set(userId, timestamps)
  return false
}

const raw = Number(process.env.HEALTH_PORT ?? "3000")
const port = Number.isFinite(raw) ? raw : 3000

Bun.serve({
  port,
  fetch(request: Request) {
    const url = new URL(request.url)
    if (url.pathname === "/health") {
      return new Response(JSON.stringify({ status: "ok", timestamp: Date.now() }), {
        headers: { "Content-Type": "application/json" },
      })
    }
    return new Response("Not Found", { status: 404 })
  },
})

console.log("Health endpoint ready on port", port)

// Background event subscription — handles both live streaming and tool notifications
async function subscribeToEvents(): Promise<void> {
  while (true) {
    try {
      const events = await nikcli.client.event.subscribe()
      for await (const event of events.stream) {
        if (event.type === "session.idle") {
          FollowUps.onSessionIdle(event.properties.sessionID)
          continue
        }
        if (event.type !== "message.part.updated") continue
        const part = event.properties.part

        // Live text streaming: update Slack message as text arrives
        if (part.type === "text" && !part.synthetic && !part.ignored && "sessionID" in part && "id" in part) {
          const tp = part as TextPart
          const s = activeStreams.get(tp.sessionID)
          if (s && tp.text) {
            s.partTexts.set(tp.id, tp.text)
            scheduleStreamFlush(tp.sessionID)
          }
        }

        // Tool completion notifications
        if (
          taskNotificationsEnabled &&
          part.type === "tool" &&
          part.state.status === "completed" &&
          "sessionID" in part &&
          "tool" in part
        ) {
          const toolPart = part as unknown as ToolPart
          const state = toolPart.state as ToolStateCompleted
          if (toolPart.sessionID) {
            for (const session of sessions.values()) {
              if (session.sessionId === toolPart.sessionID) {
                app.client.chat
                  .postMessage({
                    channel: session.channel,
                    thread_ts: session.thread,
                    text: `*${toolPart.tool}* — ${state.title}`,
                    ...botUsernameOpts,
                  })
                  .catch((err) => console.error("Failed to post tool notification:", err))
                break
              }
            }
          }
        }
      }
    } catch (err) {
      console.error("Event stream error:", err)
      await new Promise((resolve) => setTimeout(resolve, 5000))
    }
  }
}
subscribeToEvents()

app.message(async (args) => {
  const message = args.message as SlackMessage

  const channel = message.channel
  const thread = message.thread_ts ?? message.ts
  const botId = typeof args.context?.botUserId === "string" ? args.context.botUserId : ""
  const direct = message.channel_type === "im" || message.channel_type === "mpim" || message.channel.startsWith("D")

  // Messages inside the AI Assistant panel are threaded IMs handled by the
  // Assistant middleware — skip them here to avoid double-processing.
  if (message.channel_type === "im" && message.thread_ts) return

  // Handle file_share events (audio transcription) — only pure file shares, not text+file combos
  if (message.subtype === "file_share") {
    const msgText = message.text ?? ""
    const mention = direct ? false : hasMention(msgText, botId)
    if (!direct && !mention) return
    if (allowedChannels.size > 0 && !allowedChannels.has(channel)) return

    const file = message.files?.[0]
    if (!file) return

    if (PROCESSING_FILES.has(file.id)) return
    PROCESSING_FILES.add(file.id)

    try {
      const transcript = await transcribeAudioFile(file)
      if (!transcript) return

      await app.client.chat.postMessage({
        channel,
        thread_ts: thread,
        text: `_Transcription:_ ${transcript}`,
        ...botUsernameOpts,
      })

      await processPrompt(transcript, channel, thread, args.say, {
        team: typeof args.context?.teamId === "string" ? args.context.teamId : undefined,
        requester: message.user,
      })
    } finally {
      PROCESSING_FILES.delete(file.id)
    }
    return
  }

  if (message.subtype || !message.text) return

  const text = message.text
  const mention = direct ? false : hasMention(text, botId)

  if (!direct && !mention) return
  if (allowedChannels.size > 0 && !allowedChannels.has(channel)) return

  const userId = message.user ?? ""
  if (userId && isRateLimited(userId)) {
    await args.say({ text: "Rate limit exceeded. Please wait.", thread_ts: thread })
    return
  }

  const prompt = stripMention(text, botId)
  if (!prompt) {
    await args.say({
      text: "Please include a prompt after mentioning me.",
      thread_ts: thread,
      ...botUsernameOpts,
    })
    return
  }

  console.log("Processing message:", prompt)
  await processPrompt(prompt, channel, thread, args.say, {
    team: typeof args.context?.teamId === "string" ? args.context.teamId : undefined,
    requester: userId || undefined,
  })
})

async function processPrompt(
  prompt: string,
  channel: string,
  thread: string,
  say: SayFn,
  opts: { team?: string; requester?: string } = {},
): Promise<void> {
  const sessionKey = `${channel}-${thread}`
  const session = await getSession(sessionKey, channel, thread, say)
  if (!session) return

  // Channel-scoped context + tool policy injected into the prompt.
  const channelKey = ChannelMemory.keyOf(opts.team, channel)
  ChannelMemory.record(channelKey, prompt)
  const system = ChannelMemory.systemPreamble(channelKey)
  const tools = ChannelTools.toolsFor(ChannelTools.keyOf(opts.team, channel))

  FollowUps.startWork(session.sessionId, channel, thread, opts.requester)

  const thinkingMsg = await app.client.chat
    .postMessage({ channel, thread_ts: thread, text: "_Thinking…_", ...botUsernameOpts })
    .catch(() => undefined)

  if (thinkingMsg?.ok && thinkingMsg.ts) {
    activeStreams.set(session.sessionId, { channel, ts: thinkingMsg.ts, partTexts: new Map(), timer: null })
  }

  let responseText = "Sorry, I had trouble processing your message. Please try again."
  try {
    let retries = 2
    while (retries >= 0) {
      try {
        console.log("Sending to nikcli:", prompt)
        const result = await nikcli.client.session.prompt({
          path: { id: session.sessionId },
          ...(dirQuery ? { query: dirQuery } : {}),
          body: {
            parts: [{ type: "text", text: prompt }],
            ...modelBody,
            ...(system ? { system } : {}),
            ...(tools ? { tools } : {}),
          },
        })

        if (result.error) {
          const errorStr = String(result.error)
          console.error("Nikcli error:", errorStr)
          if (retries > 0 && errorStr.includes("rate")) {
            await new Promise((resolve) => setTimeout(resolve, 1000))
            retries--
            continue
          }
        } else {
          responseText = extractResponseText(result.data)
          console.log("Nikcli response:", responseText.slice(0, 80))
        }
        break
      } catch (err) {
        console.error("nikcli prompt exception:", err)
        if (retries > 0) {
          await new Promise((resolve) => setTimeout(resolve, 1000))
          retries--
          continue
        }
        break
      }
    }
  } finally {
    const s = activeStreams.get(session.sessionId)
    if (s?.timer) clearTimeout(s.timer)
    activeStreams.delete(session.sessionId)
  }

  const formattedResponse = formatForSlack(responseText)

  if (thinkingMsg?.ok && thinkingMsg.ts) {
    await app.client.chat
      .update({ channel, ts: thinkingMsg.ts, text: formattedResponse, ...botUsernameOpts })
      .catch(() => say({ text: formattedResponse, thread_ts: thread, ...botUsernameOpts }))
  } else {
    await say({ text: formattedResponse, thread_ts: thread, ...botUsernameOpts })
  }
}

app.command("/test", async (args) => {
  await args.ack()
  await args.say("Bot is working!")
})

// Admin-managed per-channel tool policy: /nikcli-tools [list|allow <tool>|deny <tool>|reset]
app.command("/nikcli-tools", async (args) => {
  await args.ack()
  const key = ChannelTools.keyOf(args.command.team_id, args.command.channel_id)
  const reply = ChannelTools.handleCommand(args.command.text ?? "", key, args.command.user_id)
  await args.respond({ response_type: "ephemeral", text: reply })
})

// AI Assistant panel surface (the Claude-icon side panel in Slack).
const assistant = new Assistant({
  threadStarted: async ({ say, setSuggestedPrompts }) => {
    await say("Hi, I'm nikcli. Tell me what to build, debug, or investigate and I'll get to work.")
    await setSuggestedPrompts({
      title: "Try asking:",
      prompts: [
        { title: "Explain this repo", message: "Give me an overview of this repository." },
        { title: "Fix failing tests", message: "Investigate and fix the failing tests." },
        { title: "Open a PR", message: "Implement the change we discussed and open a pull request." },
      ],
    })
  },
  userMessage: async ({ message, say, setStatus, context }) => {
    const m = message as { text?: string; channel?: string; thread_ts?: string; ts?: string; user?: string }
    const text = m.text?.trim()
    if (!text || !m.channel) return
    const thread = m.thread_ts ?? m.ts ?? ""
    await setStatus("is thinking…")
    await processPrompt(text, m.channel, thread, say, {
      team: typeof context?.teamId === "string" ? context.teamId : undefined,
      requester: m.user,
    })
  },
})
app.assistant(assistant)

// Graceful shutdown
process.on("SIGTERM", () => shutdown())
process.on("SIGINT", () => shutdown())

async function shutdown(): Promise<void> {
  console.log("Shutting down...")
  if (persistTimer) {
    clearTimeout(persistTimer)
    persistTimer = null
    await persistSessions()
  }
  FollowUps.stop()
  await Promise.all([ChannelMemory.flush(), ChannelTools.flush()]).catch(() => {})
  await app.stop().catch(() => {})
  nikcli.server.close()
  process.exit(0)
}

await app.start()
console.log("Slack bot is running!")

async function transcribeAudioFile(file: SlackFile): Promise<string | null> {
  if (!OPENROUTER_API_KEY) return null

  const filetype = file.filetype ?? ""
  const filename = file.name ?? "voice"
  const mimetype = file.mimetype ?? ""
  const isAudio =
    mimetype.startsWith("audio/") ||
    mimetype.startsWith("video/") ||
    AUDIO_EXTENSIONS.some((ext) => filetype === ext.slice(1) || filename.toLowerCase().endsWith(ext))
  if (!isAudio || !file.url_private) return null

  const download = await fetch(file.url_private, {
    headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` },
  })
  if (!download.ok) return null

  const arrayBuffer = await download.arrayBuffer()
  const type = download.headers.get("content-type") || mimetype || "application/octet-stream"
  const audioBlob = new Blob([new Uint8Array(arrayBuffer)], { type })

  const formData = new FormData()
  formData.append("file", audioBlob, filename)
  formData.append("model", WHISPER_API_MODEL)
  if (WHISPER_LANGUAGE) formData.append("language", WHISPER_LANGUAGE)

  const response = await fetch(WHISPER_ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENROUTER_API_KEY}` },
    body: formData,
  })
  if (!response.ok) {
    console.error("Whisper transcription failed:", await response.text())
    return null
  }

  const result = (await response.json()) as { text?: string }
  return result.text ?? null
}

function hasMention(text: string, botId: string): boolean {
  if (!botId) return false
  return new RegExp(`<@${botId}(\\|[^>]+)?>`).test(text)
}

function stripMention(text: string, botId: string): string {
  if (!botId) return text.trim()
  return text.replace(new RegExp(`<@${botId}(\\|[^>]+)?>`, "g"), "").trim()
}

function isTextPart(part: Part): part is TextPart {
  return part.type === "text"
}

function formatForSlack(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/gs, "*$1*") // **bold** → *bold*
    .replace(/(?<!\*)\*([^*\n]+?)\*(?!\*)/g, "_$1_") // *italic* → _italic_
    .replace(/^#{1,3} (.+)$/gm, "*$1*") // # Heading → *Heading*
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, "<$2|$1>") // [text](url) → <url|text>
}

function extractResponseText(
  data?: { info?: { error?: { name?: string; data?: { message?: string } } }; parts?: Part[] } | null,
): string {
  if (!data) return "I received your message but had no response."

  const apiError = data.info?.error
  if (apiError) {
    const msg = apiError.data?.message ?? apiError.name ?? "Unknown error"
    return `⚠️ ${msg}`
  }

  const textParts = (data.parts ?? [])
    .filter(isTextPart)
    .filter((p) => !p.synthetic && !p.ignored)
    .map((p) => p.text)
    .filter(Boolean)

  if (textParts.length) return textParts.join("\n")
  return "I received your message but had no response."
}

async function getSession(sessionKey: string, channel: string, thread: string, say: SayFn): Promise<Session | null> {
  const cached = sessions.get(sessionKey)
  if (cached) return cached

  console.log("Creating new nikcli session...")

  const createResult = await nikcli.client.session.create({
    body: { title: `Slack thread ${thread}` },
    ...(dirQuery ? { query: dirQuery } : {}),
  })

  if (createResult.error || !createResult.data?.id) {
    console.error("Failed to create session:", createResult.error)
    await say({ text: "Sorry, I couldn't create a session. Please try again.", thread_ts: thread })
    return null
  }

  console.log("Created nikcli session:", createResult.data.id)

  const session: PersistedSession = { sessionId: createResult.data.id, channel, thread, createdAt: Date.now() }
  sessions.set(sessionKey, session)
  schedulePersist()

  const shareResult = await nikcli.client.session.share({ path: { id: createResult.data.id } })
  if (!shareResult.error && shareResult.data?.share?.url) {
    await app.client.chat
      .postMessage({
        channel,
        thread_ts: thread,
        text: `<${shareResult.data.share.url}|Open session in nikcli>`,
        ...botUsernameOpts,
      })
      .catch(() => {})
  }

  return session
}
