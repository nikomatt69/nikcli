import {
  Client,
  Events,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  SlashCommandBuilder,
  type Attachment,
  type ChatInputCommandInteraction,
  type Message,
  type TextBasedChannel,
} from "discord.js"
import {
  createNikcliClient,
  type Part,
  type SessionPromptResponse,
  type TextPart,
  type ToolPart,
  type ToolStateCompleted,
} from "@nikcli-ai/sdk/httpapi"
import { createNikcli } from "@nikcli-ai/sdk/server"
import { ChannelMemory } from "./channel-memory"
import { ChannelTools } from "./channel-tools"
import { FollowUps } from "./followups"
import { CONNECTOR_NAME, INVITE_PERMISSIONS, inviteUrl, lookupBotUser, type DiscordUser } from "./invite"

export { CONNECTOR_NAME, INVITE_PERMISSIONS, inviteUrl, lookupBotUser, type DiscordUser }

export type DiscordBotStartOptions = {
  botToken: string
  nikcliUrl?: string
  nikcliUsername?: string
  nikcliPassword?: string
  /** x-nikcli-directory for session.prompt */
  directory?: string
  model?: string
  workdir?: string
}

export type DiscordBotStatus = {
  running: boolean
  username?: string
  clientId?: string
  inviteUrl?: string
}

const DISCORD_MAX_CHARS = 2000
const STREAM_CURSOR = " ▋"
const STREAM_FLUSH_MS = 600
const RATE_WINDOW_MS = 60_000
const SESSION_TTL_MS = 60 * 60 * 1000
const SESSION_CLEANUP_INTERVAL_MS = 5 * 60 * 1000
const AUDIO_EXTENSIONS = [".mp3", ".ogg", ".wav", ".m4a", ".webm", ".mp4", ".flac", ".aac"]
const VOICE_MESSAGE_FLAG = 1 << 13

type Session = { sessionId: string; channel: string; thread: string }
type PersistedSession = Session & { createdAt: number }

type StreamState = {
  message: Message
  partTexts: Map<string, string>
  timer: ReturnType<typeof setTimeout> | null
}

type NikcliHandle = {
  client: ReturnType<typeof createNikcliClient>
  server: { url: string; close(): void }
}

type Runtime = {
  client: Client
  nikcli: NikcliHandle
  startedServer: boolean
  abort: AbortController
  username: string
  clientId: string
  invite: string
  sessions: Map<string, PersistedSession>
  activeStreams: Map<string, StreamState>
  persistTimer: ReturnType<typeof setTimeout> | null
  cleanupInterval: ReturnType<typeof setInterval>
  userRateLimit: Map<string, number[]>
  processingFiles: Set<string>
  dirQuery: { directory?: string }
  modelBody: { model?: { providerID: string; modelID: string } }
  allowedChannels: Set<string>
  taskNotificationsEnabled: boolean
  rateLimitPerUser: number
}

let runtime: Runtime | null = null
let starting: Promise<DiscordBotStatus> | null = null

const toolsCommand = new SlashCommandBuilder()
  .setName("nikcli-tools")
  .setDescription("Manage per-channel nikcli tool policy")
  .addSubcommand((sub) => sub.setName("list").setDescription("Show tool policy for this channel"))
  .addSubcommand((sub) =>
    sub
      .setName("allow")
      .setDescription("Allow a tool in this channel")
      .addStringOption((opt) => opt.setName("tool").setDescription("Tool name").setRequired(true)),
  )
  .addSubcommand((sub) =>
    sub
      .setName("deny")
      .setDescription("Deny a tool in this channel")
      .addStringOption((opt) => opt.setName("tool").setDescription("Tool name").setRequired(true)),
  )
  .addSubcommand((sub) => sub.setName("reset").setDescription("Reset this channel to workspace defaults"))

export function isDiscordBotRunning(): boolean {
  return runtime !== null
}

export function getDiscordBotStatus(): DiscordBotStatus {
  if (!runtime) return { running: false }
  return {
    running: true,
    username: runtime.username,
    clientId: runtime.clientId,
    inviteUrl: runtime.invite,
  }
}

export async function startDiscordBot(opts: DiscordBotStartOptions): Promise<DiscordBotStatus> {
  if (runtime) return getDiscordBotStatus()
  if (starting) return starting
  starting = startBot(opts)
  try {
    return await starting
  } finally {
    starting = null
  }
}

export async function stopDiscordBot(): Promise<boolean> {
  const current = runtime
  if (!current) return false
  runtime = null

  if (current.persistTimer) {
    clearTimeout(current.persistTimer)
    current.persistTimer = null
    await persistSessions(current)
  }
  clearInterval(current.cleanupInterval)
  for (const s of current.activeStreams.values()) {
    if (s.timer) clearTimeout(s.timer)
  }
  current.activeStreams.clear()
  FollowUps.stop()
  await Promise.all([ChannelMemory.flush(), ChannelTools.flush()]).catch(() => {})
  current.abort.abort()
  await current.client.destroy().catch(() => {})
  if (current.startedServer) current.nikcli.server.close()
  return true
}

async function startBot(opts: DiscordBotStartOptions): Promise<DiscordBotStatus> {
  const token = opts.botToken.trim()
  if (!token) {
    printDoctor("missing-token")
    throw doctorError("DISCORD_BOT_TOKEN is not set")
  }

  let botUser: DiscordUser
  try {
    botUser = await lookupBotUser(token)
  } catch (err) {
    if (err instanceof Error && err.message === "Invalid Discord bot token") {
      printDoctor("invalid-token")
      throw doctorError("Invalid Discord bot token")
    }
    throw err
  }

  const clientId = process.env.DISCORD_CLIENT_ID?.trim() || botUser.id
  const invite = inviteUrl(clientId)
  const model = opts.model ?? process.env.NIKCLI_MODEL ?? "minimax-coding-plan/MiniMax-M2.5"
  const directory = opts.directory ?? opts.workdir ?? process.env.NIKCLI_WORKDIR
  const dirQuery = directory ? { directory } : {}
  const [providerID, ...modelParts] = model.split("/")
  const modelID = modelParts.join("/")
  const modelBody = providerID && modelID ? { model: { providerID, modelID } } : {}
  const allowedChannels = new Set((process.env.DISCORD_ALLOWED_CHANNELS ?? "").split(/[\s,]+/).filter(Boolean))
  const taskNotificationsEnabled =
    process.env.NIKCLI_DISCORD_TASK_NOTIFICATIONS !== "false" &&
    process.env.DISCORD_TASK_NOTIFICATIONS !== "false" &&
    process.env.DISCORD_TASK_NOTIFICATIONS !== "0"
  const rateLimitPerUser = Math.max(1, Number(process.env.DISCORD_RATE_LIMIT_PER_USER ?? "2000"))
  const sessionsFile = process.env.SESSIONS_FILE ?? "/tmp/discord-sessions.json"

  console.log("Bot configuration:")
  console.log("- Bot token present:", true)
  console.log("- Bot user:", botUser.username, `(${botUser.id})`)
  console.log("- Invite URL:", invite)
  console.log("- Model:", model)
  console.log("- Allowed channels:", allowedChannels.size > 0 ? [...allowedChannels].join(", ") : "all")
  console.log("- Task notifications:", taskNotificationsEnabled)
  console.log("- Rate limit:", rateLimitPerUser, "req/min")

  const abort = new AbortController()
  let nikcli: NikcliHandle
  let startedServer = false
  const nikcliUrl = opts.nikcliUrl ?? process.env.NIKCLI_URL
  const nikcliUsername = opts.nikcliUsername ?? process.env.NIKCLI_USERNAME
  const nikcliPassword = opts.nikcliPassword ?? process.env.NIKCLI_PASSWORD

  if (nikcliUrl) {
    console.log(`Connecting to remote nikcli server: ${nikcliUrl}`)
    const headers: Record<string, string> = {}
    if (nikcliUsername !== undefined || nikcliPassword !== undefined) {
      const basic = Buffer.from(`${nikcliUsername ?? ""}:${nikcliPassword ?? ""}`).toString("base64")
      headers.Authorization = `Basic ${basic}`
    }
    const client = createNikcliClient({
      baseUrl: nikcliUrl,
      directory,
      headers,
      signal: abort.signal,
    })
    nikcli = { client, server: { url: nikcliUrl, close() {} } }
    console.log("Nikcli remote server ready")
  } else {
    console.log("Starting local nikcli server...")
    nikcli = await createNikcli({
      port: 0,
      timeout: Number(process.env.NIKCLI_START_TIMEOUT_MS ?? "120000"),
      config: { model },
    })
    startedServer = true
    console.log("Nikcli server ready")
  }

  const sessions = new Map<string, PersistedSession>()
  try {
    const raw = await Bun.file(sessionsFile).text()
    const parsed = JSON.parse(raw) as Record<string, PersistedSession>
    const now = Date.now()
    for (const [key, s] of Object.entries(parsed)) {
      if (now - s.createdAt < SESSION_TTL_MS) sessions.set(key, s)
    }
    console.log(`Loaded ${sessions.size} sessions from disk`)
  } catch {
    // file doesn't exist yet — fresh start
  }

  await ChannelMemory.init()
  await ChannelTools.init()

  const discord = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel, Partials.Message],
  })

  const holder: { rt?: Runtime } = {}
  const cleanupInterval = setInterval(() => {
    if (holder.rt) tickCleanup(holder.rt, sessionsFile)
  }, SESSION_CLEANUP_INTERVAL_MS)
  if (typeof cleanupInterval === "object" && "unref" in cleanupInterval) cleanupInterval.unref()

  const rt: Runtime = {
    client: discord,
    nikcli,
    startedServer,
    abort,
    username: botUser.username,
    clientId,
    invite,
    sessions,
    activeStreams: new Map(),
    persistTimer: null,
    cleanupInterval,
    userRateLimit: new Map(),
    processingFiles: new Set(),
    dirQuery,
    modelBody,
    allowedChannels,
    taskNotificationsEnabled,
    rateLimitPerUser,
  }
  holder.rt = rt

  FollowUps.configure({
    post: async (_channel, thread, text) => {
      await sendToChannelId(rt, thread, formatForDiscord(text)).catch((err) =>
        console.error("Follow-up post failed:", err),
      )
    },
  })

  discord.on(Events.MessageCreate, (message) => {
    void handleMessage(rt, message)
  })
  discord.on(Events.InteractionCreate, (interaction) => {
    if (!interaction.isChatInputCommand()) return
    void handleSlashCommand(rt, interaction)
  })

  try {
    await discord.login(token)
  } catch (err) {
    await teardownFailedStart(rt)
    if (isDisallowedIntents(err)) {
      printDoctor("intents", invite)
      throw doctorError("Discord privileged intent missing (4014)")
    }
    if (isInvalidToken(err)) {
      printDoctor("invalid-token", invite)
      throw doctorError("Invalid Discord bot token")
    }
    printDoctor("invalid-token", invite)
    throw doctorError(err instanceof Error ? err.message : "Failed to login to Discord")
  }

  const readyUser = discord.user
  if (readyUser) {
    rt.username = readyUser.username
    rt.clientId = discord.application?.id ?? clientId
    rt.invite = inviteUrl(rt.clientId)
  }

  try {
    const rest = new REST({ version: "10" }).setToken(token)
    await rest.put(Routes.applicationCommands(rt.clientId), { body: [toolsCommand.toJSON()] })
    console.log("Registered /nikcli-tools slash command")
  } catch (err) {
    console.error("Failed to register slash commands:", err instanceof Error ? err.message : err)
  }

  runtime = rt
  void subscribeToEvents(rt)
  console.log("Discord bot is running!")
  return getDiscordBotStatus()
}

async function teardownFailedStart(rt: Runtime): Promise<void> {
  clearInterval(rt.cleanupInterval)
  FollowUps.stop()
  rt.abort.abort()
  await rt.client.destroy().catch(() => {})
  if (rt.startedServer) rt.nikcli.server.close()
}

function tickCleanup(rt: Runtime, sessionsFile: string): void {
  const now = Date.now()
  let sessionsChanged = false
  for (const [key, s] of rt.sessions.entries()) {
    if (now - s.createdAt > SESSION_TTL_MS) {
      rt.sessions.delete(key)
      sessionsChanged = true
    }
  }
  if (sessionsChanged) schedulePersist(rt, sessionsFile)

  for (const [userId, timestamps] of rt.userRateLimit.entries()) {
    const valid = timestamps.filter((t) => now - t < RATE_WINDOW_MS)
    if (valid.length === 0) rt.userRateLimit.delete(userId)
    else if (valid.length !== timestamps.length) rt.userRateLimit.set(userId, valid)
  }
}

function schedulePersist(rt: Runtime, sessionsFile = process.env.SESSIONS_FILE ?? "/tmp/discord-sessions.json"): void {
  if (rt.persistTimer) clearTimeout(rt.persistTimer)
  rt.persistTimer = setTimeout(() => {
    rt.persistTimer = null
    void persistSessions(rt, sessionsFile)
  }, 2000)
}

async function persistSessions(
  rt: Runtime,
  sessionsFile = process.env.SESSIONS_FILE ?? "/tmp/discord-sessions.json",
): Promise<void> {
  try {
    const obj: Record<string, PersistedSession> = {}
    for (const [k, v] of rt.sessions.entries()) obj[k] = v
    await Bun.write(sessionsFile, JSON.stringify(obj))
  } catch (err) {
    console.error("Failed to persist sessions:", err)
  }
}

function isRateLimited(rt: Runtime, userId: string): boolean {
  const now = Date.now()
  const timestamps = (rt.userRateLimit.get(userId) ?? []).filter((t) => now - t < RATE_WINDOW_MS)
  if (timestamps.length >= rt.rateLimitPerUser) return true
  timestamps.push(now)
  rt.userRateLimit.set(userId, timestamps)
  return false
}

async function subscribeToEvents(rt: Runtime): Promise<void> {
  while (!rt.abort.signal.aborted) {
    try {
      const events = await rt.nikcli.client.event.subscribe()
      for await (const event of events.stream) {
        if (rt.abort.signal.aborted) return
        if (event.type === "session.idle") {
          FollowUps.onSessionIdle(event.properties.sessionID)
          continue
        }
        if (event.type !== "message.part.updated") continue
        const part = event.properties.part

        if (part.type === "text" && !part.synthetic && !part.ignored && "sessionID" in part && "id" in part) {
          const tp = part as TextPart
          const s = rt.activeStreams.get(tp.sessionID)
          if (s && tp.text) {
            s.partTexts.set(tp.id, tp.text)
            scheduleStreamFlush(rt, tp.sessionID)
          }
        }

        if (
          rt.taskNotificationsEnabled &&
          part.type === "tool" &&
          part.state.status === "completed" &&
          "sessionID" in part &&
          "tool" in part
        ) {
          const toolPart = part as unknown as ToolPart
          const state = toolPart.state as ToolStateCompleted
          if (toolPart.sessionID) {
            for (const session of rt.sessions.values()) {
              if (session.sessionId === toolPart.sessionID) {
                void sendToChannelId(rt, session.thread, `**${toolPart.tool}** — ${state.title}`).catch((err) =>
                  console.error("Failed to post tool notification:", err),
                )
                break
              }
            }
          }
        }
      }
    } catch (err) {
      if (rt.abort.signal.aborted) return
      console.error("Event stream error:", err)
      await new Promise((resolve) => setTimeout(resolve, 5000))
    }
  }
}

function scheduleStreamFlush(rt: Runtime, sessionId: string): void {
  const s = rt.activeStreams.get(sessionId)
  if (!s) return
  if (s.timer) clearTimeout(s.timer)
  s.timer = setTimeout(() => {
    const current = rt.activeStreams.get(sessionId)
    if (!current) return
    const text = [...current.partTexts.values()].join("\n").trim()
    if (!text) return
    const formatted = truncateForStream(formatForDiscord(text))
    current.message.edit(formatted).catch(() => {})
  }, STREAM_FLUSH_MS)
}

async function handleMessage(rt: Runtime, raw: Message): Promise<void> {
  let message = raw
  if (message.partial) {
    try {
      message = await message.fetch()
    } catch {
      return
    }
  }
  if (message.author.bot || message.system) return

  const botId = rt.client.user?.id ?? ""
  const direct = message.channel.isDMBased()
  const mentioned = botId ? message.mentions.users.has(botId) : false
  const work = resolveWorkIds(message)
  const sessionKey = `${work.parentId}-${work.threadId}`
  const hasSession = work.inThread && rt.sessions.has(sessionKey)

  if (!direct && !mentioned && !hasSession) return
  if (rt.allowedChannels.size > 0 && !rt.allowedChannels.has(work.parentId)) return

  const audio =
    [...message.attachments.values()].find(isAudioAttachment) ??
    ((message.flags.bitfield & VOICE_MESSAGE_FLAG) !== 0 ? [...message.attachments.values()][0] : undefined)
  const promptText = stripMention(message.content ?? "", botId)

  if (audio) {
    if (rt.processingFiles.has(audio.id)) return
    rt.processingFiles.add(audio.id)
    try {
      const transcript = await transcribeAudioFile(audio)
      if (transcript) {
        const channel = await ensureWorkChannel(message, work, promptText || transcript)
        if (!channel) return
        await sendChunks(channel, `*Transcription:* ${transcript}`).catch(() => {})
        const prompt = [promptText, transcript].filter(Boolean).join("\n")
        await processPrompt(rt, prompt, message, channel, work)
        return
      }
    } finally {
      rt.processingFiles.delete(audio.id)
    }
    if (!promptText && !direct && !hasSession) return
  }

  if (!promptText) {
    if (!mentioned) return
    const channel = await ensureWorkChannel(message, work, "nikcli")
    if (!channel) return
    await sendChunks(channel, "Please include a prompt after mentioning me.")
    return
  }

  const userId = message.author.id
  if (isRateLimited(rt, userId)) {
    const channel = await ensureWorkChannel(message, work, promptText)
    if (!channel) return
    await sendChunks(channel, "Rate limit exceeded. Please wait.")
    return
  }

  console.log("Processing message:", promptText)
  const channel = await ensureWorkChannel(message, work, promptText)
  if (!channel) return
  await processPrompt(rt, promptText, message, channel, work)
}

type WorkIds = {
  parentId: string
  threadId: string
  inThread: boolean
  guildId?: string
}

function resolveWorkIds(message: Message): WorkIds {
  const guildId = message.guildId ?? undefined
  if (message.channel.isDMBased()) {
    return { parentId: message.channel.id, threadId: message.channel.id, inThread: false, guildId }
  }
  if (message.channel.isThread()) {
    const parentId = message.channel.parentId ?? message.channel.id
    return { parentId, threadId: message.channel.id, inThread: true, guildId }
  }
  if (message.hasThread && message.thread) {
    return { parentId: message.channel.id, threadId: message.thread.id, inThread: true, guildId }
  }
  return { parentId: message.channel.id, threadId: message.id, inThread: false, guildId }
}

async function ensureWorkChannel(
  message: Message,
  work: WorkIds,
  threadName: string,
): Promise<TextBasedChannel | null> {
  if (message.channel.isDMBased()) return message.channel
  if (message.channel.isThread()) return message.channel
  if (message.hasThread && message.thread) return message.thread
  if (!message.inGuild() || !message.channel.isTextBased())
    return message.channel.isTextBased() ? message.channel : null

  const name = threadName.replace(/\s+/g, " ").trim().slice(0, 100) || "nikcli"
  try {
    const thread = await message.startThread({ name, autoArchiveDuration: 60 })
    work.threadId = thread.id
    work.inThread = true
    return thread
  } catch (err) {
    if (message.thread) {
      work.threadId = message.thread.id
      work.inThread = true
      return message.thread
    }
    console.error("Failed to create Discord thread:", err instanceof Error ? err.message : err)
    work.threadId = message.channel.id
    return message.channel.isTextBased() ? message.channel : null
  }
}

async function processPrompt(
  rt: Runtime,
  prompt: string,
  message: Message,
  channel: TextBasedChannel,
  work: WorkIds,
): Promise<void> {
  const sessionKey = `${work.parentId}-${work.threadId}`
  const session = await getSession(rt, sessionKey, channel, work)
  if (!session) return

  const channelKey = ChannelMemory.keyOf(work.guildId, work.parentId)
  ChannelMemory.record(channelKey, prompt)
  const system = ChannelMemory.systemPreamble(channelKey)
  const tools = ChannelTools.toolsFor(ChannelTools.keyOf(work.guildId, work.parentId))

  FollowUps.startWork(session.sessionId, work.parentId, session.thread, message.author.id)

  const thinkingMsg = await sendChunks(channel, "*Thinking…*").catch(() => undefined)
  if (thinkingMsg) {
    rt.activeStreams.set(session.sessionId, { message: thinkingMsg, partTexts: new Map(), timer: null })
  }

  let responseText = "Sorry, I had trouble processing your message. Please try again."
  try {
    let retries = 2
    while (retries >= 0) {
      try {
        console.log("Sending to nikcli:", prompt)
        const result = await rt.nikcli.client.session.prompt({
          sessionID: session.sessionId,
          ...rt.dirQuery,
          parts: [{ type: "text", text: prompt }],
          ...rt.modelBody,
          ...(system ? { system } : {}),
          ...(tools ? { tools } : {}),
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
    const s = rt.activeStreams.get(session.sessionId)
    if (s?.timer) clearTimeout(s.timer)
    rt.activeStreams.delete(session.sessionId)
  }

  const chunks = chunkForDiscord(formatForDiscord(responseText))
  const first = chunks[0] || "I received your message but had no response."
  if (thinkingMsg) {
    try {
      await thinkingMsg.edit(first)
      for (const extra of chunks.slice(1)) {
        await sendRaw(channel, extra)
      }
    } catch {
      await sendChunks(channel, responseText)
    }
  } else {
    await sendChunks(channel, responseText)
  }
}

async function getSession(
  rt: Runtime,
  sessionKey: string,
  channel: TextBasedChannel,
  work: WorkIds,
): Promise<Session | null> {
  const cached = rt.sessions.get(sessionKey)
  if (cached) return cached

  console.log("Creating new nikcli session...")

  const createResult = await rt.nikcli.client.session.create({
    title: `Discord thread ${work.threadId}`,
    ...rt.dirQuery,
  })

  if (createResult.error || !createResult.data?.id) {
    console.error("Failed to create session:", createResult.error)
    await sendChunks(channel, "Sorry, I couldn't create a session. Please try again.")
    return null
  }

  console.log("Created nikcli session:", createResult.data.id)

  const session: PersistedSession = {
    sessionId: createResult.data.id,
    channel: work.parentId,
    thread: work.threadId,
    createdAt: Date.now(),
  }
  rt.sessions.set(sessionKey, session)
  schedulePersist(rt)

  const shareResult = await rt.nikcli.client.session.share({ sessionID: createResult.data.id, ...rt.dirQuery })
  if (!shareResult.error && shareResult.data?.share?.url) {
    await sendChunks(channel, `[Open session in nikcli](${shareResult.data.share.url})`).catch(() => {})
  }

  return session
}

async function handleSlashCommand(rt: Runtime, interaction: ChatInputCommandInteraction): Promise<void> {
  if (interaction.commandName !== "nikcli-tools") return

  const parentId =
    interaction.channel?.isThread() && interaction.channel.parentId
      ? interaction.channel.parentId
      : interaction.channelId
  const key = ChannelTools.keyOf(interaction.guildId ?? undefined, parentId)
  const sub = interaction.options.getSubcommand(false) ?? "list"
  const tool = interaction.options.getString("tool") ?? ""
  const text = tool ? `${sub} ${tool}` : sub
  const reply = ChannelTools.handleCommand(text, key, interaction.user.id)
  await interaction.reply({ content: chunkForDiscord(reply)[0] ?? reply, ephemeral: true }).catch((err) => {
    console.error("Failed to reply to /nikcli-tools:", err)
  })
}

async function sendToChannelId(rt: Runtime, channelId: string, text: string): Promise<void> {
  const ch = await rt.client.channels.fetch(channelId).catch(() => null)
  if (!ch || !ch.isTextBased()) return
  await sendChunks(ch, text)
}

async function sendChunks(channel: TextBasedChannel, text: string): Promise<Message | undefined> {
  const chunks = chunkForDiscord(formatForDiscord(text))
  let last: Message | undefined
  for (const chunk of chunks) {
    last = await sendRaw(channel, chunk)
  }
  return last
}

async function sendRaw(channel: TextBasedChannel, text: string): Promise<Message | undefined> {
  if (!text) return undefined
  if (!("send" in channel) || typeof channel.send !== "function") return undefined
  return channel.send({ content: text })
}

function isAudioAttachment(file: Attachment): boolean {
  const filename = file.name ?? "voice"
  const mimetype = file.contentType ?? ""
  const isAudio =
    mimetype.startsWith("audio/") ||
    mimetype.startsWith("video/") ||
    file.duration != null ||
    file.waveform != null ||
    AUDIO_EXTENSIONS.some((ext) => filename.toLowerCase().endsWith(ext))
  return isAudio
}

async function transcribeAudioFile(file: Attachment): Promise<string | null> {
  const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY
  if (!OPENROUTER_API_KEY) return null

  const WHISPER_MODEL = process.env.WHISPER_MODEL ?? "openrouter/openai/whisper-1"
  const [whisperProvider, ...whisperModelParts] = WHISPER_MODEL.split("/")
  const WHISPER_API_MODEL = whisperModelParts.join("/") || "openai/whisper-1"
  const WHISPER_ENDPOINT =
    whisperProvider === "openrouter"
      ? "https://openrouter.ai/api/v1/audio/transcriptions"
      : "https://api.openai.com/v1/audio/transcriptions"
  const WHISPER_LANGUAGE = process.env.WHISPER_LANGUAGE

  const download = await fetch(file.url)
  if (!download.ok) return null

  const arrayBuffer = await download.arrayBuffer()
  const type = download.headers.get("content-type") || file.contentType || "application/octet-stream"
  const audioBlob = new Blob([new Uint8Array(arrayBuffer)], { type })
  const filename = file.name ?? "voice"

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

function stripMention(text: string, botId: string): string {
  if (!botId) return text.trim()
  return text.replace(new RegExp(`<@!?${botId}>`, "g"), "").trim()
}

function isTextPart(part: Part): part is TextPart {
  return part.type === "text"
}

export function formatForDiscord(text: string): string {
  return text.trim()
}

export function chunkForDiscord(text: string, limit = DISCORD_MAX_CHARS): string[] {
  if (!text) return [text]
  if (text.length <= limit) return [text]
  const chunks: string[] = []
  let remaining = text
  while (remaining.length > 0) {
    if (remaining.length <= limit) {
      chunks.push(remaining)
      break
    }
    let split = remaining.lastIndexOf("\n", limit)
    if (split < limit / 2) split = remaining.lastIndexOf(" ", limit)
    if (split < limit / 2) split = limit
    chunks.push(remaining.slice(0, split))
    remaining = remaining.slice(split).trimStart()
  }
  return chunks
}

function truncateForStream(text: string): string {
  const withCursor = `${text}${STREAM_CURSOR}`
  if (withCursor.length <= DISCORD_MAX_CHARS) return withCursor
  return `${text.slice(0, DISCORD_MAX_CHARS - STREAM_CURSOR.length)}${STREAM_CURSOR}`
}

function extractResponseText(data?: SessionPromptResponse | null): string {
  if (!data) return "I received your message but had no response."

  const apiError = data.info.role === "assistant" ? data.info.error : undefined
  if (apiError) {
    const msg = ("message" in apiError.data ? apiError.data.message : undefined) ?? apiError.name ?? "Unknown error"
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

function isDisallowedIntents(err: unknown): boolean {
  if (err && typeof err === "object" && "code" in err && (err as { code: unknown }).code === 4014) return true
  const msg = err instanceof Error ? err.message : String(err)
  return msg.includes("4014") || /disallowed intent/i.test(msg)
}

function isInvalidToken(err: unknown): boolean {
  if (err && typeof err === "object" && "status" in err && (err as { status: unknown }).status === 401) return true
  const msg = err instanceof Error ? err.message : String(err)
  return /invalid token/i.test(msg) || msg.includes("401:")
}

function doctorError(message: string): Error {
  const err = new Error(message)
  err.name = "DiscordBotError"
  err.stack = undefined
  return err
}

function printDoctor(reason: "missing-token" | "invalid-token" | "intents", invite?: string): void {
  const lines = ["", "Couldn't start the Discord bot.", "", "Checklist:"]
  if (reason === "missing-token") {
    lines.push("• Set DISCORD_BOT_TOKEN (Developer Portal → Bot → Reset Token)")
    lines.push("• Or configure from the nikcli TUI: /discord")
    lines.push("• CLI fallback: bun run setup")
  } else if (reason === "invalid-token") {
    lines.push("• The bot token is invalid — reset it in Developer Portal → Bot")
    lines.push("• Or paste a new token via the nikcli TUI: /discord")
  } else {
    lines.push("• Enable Message Content Intent (Developer Portal → Bot → Privileged Gateway Intents)")
  }
  if (invite) lines.push(`• Invite the bot: ${invite}`)
  else lines.push("• Invite the bot with the OAuth2 URL printed after setup")
  lines.push("• Enable Message Content Intent if you have not already")
  lines.push("")
  console.error(lines.join("\n"))
}
