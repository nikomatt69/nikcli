interface Env {
  SLACK_BOT_TOKEN: string
  SLACK_SIGNING_SECRET: string
  SLACK_CLIENT_ID: string
  SLACK_CLIENT_SECRET: string
  OPENAI_API_KEY: string
  NIKCLI_URL: string
  NIKCLI_USERNAME: string
  NIKCLI_PASSWORD: string
  SESSIONS: KVNamespace
}

interface SlackEventPayload {
  type?: string
  challenge?: string
  event?: SlackEvent
}

interface SlackEvent {
  type?: string
  subtype?: string
  text?: string
  channel: string
  channel_type?: string
  thread_ts?: string
  ts: string
  files?: SlackFile[]
}

interface SlackFile {
  id: string
  filetype?: string
  name?: string
  mimetype?: string
  url_private?: string
}

interface SlackPostResponse {
  ok: boolean
  error?: string
}

interface SessionData {
  sessionId: string
  channel: string
  thread: string
  createdAt: number
}

interface NikcliResponse<T = unknown> {
  error?: string
  data?: T
}

interface NikcliSessionInfo {
  id: string
  share?: {
    url: string
  }
}

interface NikcliMessagePart {
  type: string
  text?: string
  tool?: string
  state?: {
    status: string
    title?: string
  }
}

type TranscriptionResult =
  | {
      text: string
    }
  | {
      error: string
    }

const PROCESSING_FILES = new Set<string>()
const ACTIVE_SESSIONS = new Map<string, SessionData>()
const bot = { id: "" }
const encoder = new TextEncoder()

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === "/health") {
      return new Response(
        JSON.stringify({
          status: "healthy",
          timestamp: Date.now(),
          nikcliUrl: env.NIKCLI_URL || "not configured",
        }),
        {
          headers: { "Content-Type": "application/json" },
        },
      )
    }

    if (url.pathname === "/slack/events") {
      return handleSlackEvent(request, env, ctx)
    }

    if (url.pathname === "/slack/interactive") {
      return handleInteractive(request, env)
    }

    if (url.pathname === "/slack/install") {
      return handleInstall(request, env)
    }

    if (url.pathname === "/slack/oauth/callback") {
      return handleOAuthCallback(request, env)
    }

    return new Response("Not Found", { status: 404 })
  },
} satisfies ExportedHandler<Env>

async function handleSlackEvent(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const bodyText = await request.text()

  const verified = await verifySlackRequest(request, bodyText, env.SLACK_SIGNING_SECRET)
  if (!verified) {
    return new Response("Invalid signature", { status: 401 })
  }

  const body = JSON.parse(bodyText) as SlackEventPayload

  if (body.type === "url_verification") {
    return new Response(JSON.stringify({ challenge: body.challenge }))
  }

  if (body.type !== "event_callback" || !body.event) {
    return new Response("OK")
  }

  ctx.waitUntil(processEvent(body.event, env))

  return new Response("OK")
}

async function handleInteractive(request: Request, env: Env): Promise<Response> {
  const bodyText = await request.text()
  const verified = await verifySlackRequest(request, bodyText, env.SLACK_SIGNING_SECRET)

  if (!verified) {
    return new Response("Invalid signature", { status: 401 })
  }

  const params = new URLSearchParams(bodyText)
  const payload = params.get("payload")

  if (payload) {
    const parsed = JSON.parse(payload) as { type?: string }
    console.log("Interactive payload received:", parsed.type || "unknown")
  }

  return new Response("OK")
}

async function processEvent(event: SlackEvent, env: Env): Promise<void> {
  const isFileShare = event.subtype === "file_share" || (event.files && event.files.length > 0)
  if (isFileShare) {
    await handleFileShare(event, env)
    return
  }

  if (event.subtype || !event.text) return

  const channel = event.channel
  const thread = event.thread_ts || event.ts
  const text = event.text
  const direct = event.channel_type === "im" || event.channel_type === "mpim" || event.channel.startsWith("D")
  const botId = direct ? null : await getBotId(env)
  const mention = !direct && botId ? hasMention(text, botId) : false

  if (!direct && !mention) return

  const prompt = stripMention(text, botId)
  if (!prompt) {
    await postMessage(env.SLACK_BOT_TOKEN, channel, thread, "Please include a prompt after mentioning me.")
    return
  }

  await handlePrompt(event, env, prompt)
}

async function handlePrompt(event: SlackEvent, env: Env, text: string): Promise<void> {
  const channel = event.channel
  const thread = event.thread_ts || event.ts
  const sessionKey = `${channel}-${thread}`

  const cached = ACTIVE_SESSIONS.get(sessionKey)
  if (cached) {
    await sendPrompt(env, cached, text, channel, thread)
    return
  }

  const stored = await getFromKv(env, sessionKey)
  if (stored) {
    ACTIVE_SESSIONS.set(sessionKey, stored)
    await sendPrompt(env, stored, text, channel, thread)
    return
  }

  const created = await createSession(env, sessionKey, channel, thread)
  if (!created) return

  await sendPrompt(env, created, text, channel, thread)
}

async function createSession(
  env: Env,
  sessionKey: string,
  channel: string,
  thread: string,
): Promise<SessionData | null> {
  const nikcliUrl = getNikcliUrl(env)
  if (!nikcliUrl) {
    await postMessage(env.SLACK_BOT_TOKEN, channel, thread, "NIKCLI_URL is not configured")
    return null
  }

  const auth = getAuthHeader(env)

  const createResult = await fetch(`${nikcliUrl}/session`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...auth,
    },
    body: JSON.stringify({ title: `Slack thread ${thread}` }),
  })

  if (!createResult.ok) {
    console.error("Failed to create session:", await createResult.text())
    await postMessage(env.SLACK_BOT_TOKEN, channel, thread, "Failed to create session")
    return null
  }

  const createData = unwrapNikcliResponse((await createResult.json()) as NikcliResponse<NikcliSessionInfo>)

  if (createData.error || !createData.data?.id) {
    console.error("Failed to create session:", createData.error)
    await postMessage(env.SLACK_BOT_TOKEN, channel, thread, "Failed to create session")
    return null
  }

  const session: SessionData = {
    sessionId: createData.data.id,
    channel,
    thread,
    createdAt: Date.now(),
  }

  ACTIVE_SESSIONS.set(sessionKey, session)
  await saveToKv(env, sessionKey, session)

  const shareResult = await fetch(`${nikcliUrl}/session/${createData.data.id}/share`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...auth,
    },
  })

  if (shareResult.ok) {
    const shareData = unwrapNikcliResponse((await shareResult.json()) as NikcliResponse<NikcliSessionInfo>)
    if (!shareData.error && shareData.data?.share?.url) {
      await postMessage(env.SLACK_BOT_TOKEN, channel, thread, `Session: ${shareData.data.share.url}`)
    }
  }

  return session
}

async function sendPrompt(
  env: Env,
  session: SessionData,
  text: string,
  channel: string,
  thread: string,
): Promise<void> {
  const nikcliUrl = getNikcliUrl(env)
  if (!nikcliUrl) {
    await postMessage(env.SLACK_BOT_TOKEN, channel, thread, "NIKCLI_URL is not configured")
    return
  }

  const auth = getAuthHeader(env)

  const result = await fetch(`${nikcliUrl}/session/${session.sessionId}/message`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...auth,
    },
    body: JSON.stringify({ parts: [{ type: "text", text }] }),
  })

  if (!result.ok) {
    console.error("Prompt error:", await result.text())
    await postMessage(env.SLACK_BOT_TOKEN, channel, thread, "Error processing request")
    return
  }

  const resultData = unwrapNikcliResponse(
    (await result.json()) as NikcliResponse<{
      info?: { content: string }
      content?: string
      parts?: NikcliMessagePart[]
    }>,
  )

  if (resultData.error) {
    console.error("Prompt error:", resultData.error)
    await postMessage(env.SLACK_BOT_TOKEN, channel, thread, "Error processing request")
    return
  }

  const responseText = extractResponseText(resultData.data)
  await postMessage(env.SLACK_BOT_TOKEN, channel, thread, responseText)
}

function extractResponseText(data?: {
  info?: { content: string }
  content?: string
  parts?: NikcliMessagePart[]
}): string {
  if (!data) return "I received your message."

  if (data.info?.content) {
    return data.info.content
  }

  if (data.content) {
    return data.content
  }

  const textParts = data.parts?.filter((p) => p.type === "text").map((p) => p.text || "")
  if (textParts?.length && textParts.some((text) => text)) {
    return textParts.join("\n")
  }

  return "I received your message."
}

function hasMention(text: string, botId: string): boolean {
  if (!botId) return false
  const pattern = new RegExp(`<@${botId}(\\|[^>]+)?>`)
  return pattern.test(text)
}

function stripMention(text: string, botId: string | null): string {
  if (!botId) return text.trim()
  const pattern = new RegExp(`<@${botId}(\\|[^>]+)?>`, "g")
  return text.replace(pattern, "").trim()
}

async function getBotId(env: Env): Promise<string | null> {
  if (bot.id) return bot.id
  if (!env.SLACK_BOT_TOKEN) return null

  const response = await fetch("https://slack.com/api/auth.test", {
    headers: { Authorization: `Bearer ${env.SLACK_BOT_TOKEN}` },
  })

  if (!response.ok) return null

  const data = (await response.json()) as { ok?: boolean; user_id?: string; bot_id?: string }
  if (!data.ok) return null

  const id = data.user_id || data.bot_id
  if (!id) return null

  bot.id = id
  return bot.id
}

async function handleFileShare(event: SlackEvent, env: Env): Promise<void> {
  const file = event.files?.[0]
  if (!file) return

  const channel = event.channel
  const thread = event.thread_ts || event.ts
  const text = event.text || ""
  const direct = event.channel_type === "im" || event.channel_type === "mpim" || event.channel.startsWith("D")
  const botId = direct ? null : await getBotId(env)
  const mention = !direct && botId ? hasMention(text, botId) : false

  if (!direct && !mention) return

  const fileId = file.id
  if (PROCESSING_FILES.has(fileId)) return
  PROCESSING_FILES.add(fileId)

  try {
    const audioExtensions = [".mp3", ".ogg", ".wav", ".m4a", ".webm", ".mp4"]
    const filetype = file.filetype || ""
    const filename = file.name || "voice"
    const mimetype = file.mimetype || ""
    const isAudio =
      mimetype.startsWith("audio/") ||
      audioExtensions.some((ext) => filetype.includes(ext.replace(".", "")) || filename.endsWith(ext))

    if (!isAudio) return

    const urlPrivate = file.url_private
    if (!urlPrivate) return

    await postMessage(env.SLACK_BOT_TOKEN, channel, thread, "Downloading and transcribing audio...")

    const result = await transcribeAudio(urlPrivate, env.SLACK_BOT_TOKEN, env.OPENAI_API_KEY, filename, mimetype)

    if ("error" in result) {
      await postMessage(env.SLACK_BOT_TOKEN, channel, thread, result.error)
      return
    }

    const transcript = result.text

    await postMessage(env.SLACK_BOT_TOKEN, channel, thread, `Transcription:\n${transcript}`)

    await handlePrompt(event, env, transcript)
  } finally {
    PROCESSING_FILES.delete(fileId)
  }
}

async function transcribeAudio(
  audioUrl: string,
  botToken: string,
  apiKey: string,
  filename: string,
  mimetype: string,
): Promise<TranscriptionResult> {
  if (!apiKey) {
    return { error: "Voice transcription is disabled. Set OPENAI_API_KEY to enable it." }
  }

  const response = await fetch(audioUrl, {
    headers: { Authorization: `Bearer ${botToken}` },
  })

  if (!response.ok) {
    return { error: "Unable to download the audio file from Slack." }
  }

  const arrayBuffer = await response.arrayBuffer()
  const type = response.headers.get("content-type") || mimetype || "application/octet-stream"
  const audioBlob = new Blob([new Uint8Array(arrayBuffer)], { type })

  const formData = new FormData()
  formData.append("file", audioBlob, filename)
  formData.append("model", "whisper-1")
  formData.append("language", "en")

  const whisperResponse = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
  })

  if (!whisperResponse.ok) {
    const errorBody = await whisperResponse.text()
    const detail = errorBody ? ` Whisper response: ${errorBody}` : ""
    return { error: `Whisper transcription failed.${detail}` }
  }

  const whisperResult = (await whisperResponse.json()) as { text?: string }
  if (!whisperResult.text) {
    return { error: "Whisper returned an empty transcript." }
  }

  return { text: whisperResult.text }
}

async function postMessage(token: string, channel: string, threadTs: string | undefined, text: string): Promise<void> {
  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ channel, thread_ts: threadTs, text }),
  })

  if (!response.ok) {
    const errorBody = await response.text()
    console.error("Slack API error:", errorBody)
    return
  }

  const data = (await response.json()) as SlackPostResponse
  if (!data.ok) {
    console.error("Slack API response error:", data.error)
  }
}

async function handleInstall(request: Request, env: Env): Promise<Response> {
  if (!env.SLACK_CLIENT_ID) {
    return new Response("SLACK_CLIENT_ID not configured", { status: 500 })
  }

  const redirectUri = `${new URL(request.url).origin}/slack/oauth/callback`
  const scopes = ["app_mentions:read", "chat:write", "channels:history", "groups:history", "files:read"].join(",")

  const authUrl = `https://slack.com/oauth/v2/authorize?client_id=${env.SLACK_CLIENT_ID}&scope=${scopes}&redirect_uri=${encodeURIComponent(redirectUri)}`

  return new Response(
    `<!DOCTYPE html>
<html>
<head><title>Install nikcli</title></head>
<body style="font-family: system-ui; padding: 2rem; text-align: center;">
  <h1>Install nikcli Slack App</h1>
  <p>Click the button below to authorize the nikcli app in your Slack workspace.</p>
  <a href="${authUrl}" style="display: inline-block; padding: 12px 24px; background: #4A154B; color: white; text-decoration: none; border-radius: 4px; font-weight: bold;">
    Add to Slack
  </a>
</body>
</html>`,
    {
      headers: { "Content-Type": "text/html" },
    },
  )
}

async function handleOAuthCallback(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const code = url.searchParams.get("code")
  const error = url.searchParams.get("error")

  if (error) {
    return new Response(`OAuth error: ${error}`, { status: 400 })
  }

  if (!code) {
    return new Response("No authorization code received", { status: 400 })
  }

  if (!env.SLACK_CLIENT_ID || !env.SLACK_CLIENT_SECRET) {
    return new Response("Slack OAuth not configured", { status: 500 })
  }

  const response = await fetch("https://slack.com/api/oauth.v2.access", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.SLACK_CLIENT_ID,
      client_secret: env.SLACK_CLIENT_SECRET,
      code,
      redirect_uri: `${url.origin}/slack/oauth/callback`,
    }),
  })

  const data = (await response.json()) as { ok: boolean; error?: string; authed_user?: { id: string } }

  if (!data.ok) {
    return new Response(`OAuth failed: ${data.error}`, { status: 400 })
  }

  return new Response(
    `<!DOCTYPE html>
<html>
<head><title>nikcli Installed</title></head>
<body style="font-family: system-ui; padding: 2rem; text-align: center;">
  <h1>App Installed</h1>
  <p>Successfully installed as <code>${data.authed_user?.id}</code></p>
  <p>The nikcli bot is now available in your Slack workspace.</p>
  <p>Start a conversation by mentioning @nikcli in any channel.</p>
</body>
</html>`,
    {
      headers: { "Content-Type": "text/html" },
    },
  )
}

async function verifySlackRequest(request: Request, body: string, signingSecret: string): Promise<boolean> {
  const signature = request.headers.get("x-slack-signature")
  const timestamp = request.headers.get("x-slack-request-timestamp")

  if (!signature || !timestamp) return false

  const ts = Number(timestamp)
  if (!Number.isFinite(ts)) return false

  const now = Math.floor(Date.now() / 1000)
  if (Math.abs(now - ts) > 60 * 5) return false

  const base = `v0:${timestamp}:${body}`
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(signingSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const digest = await crypto.subtle.sign("HMAC", key, encoder.encode(base))
  const hash = toHex(new Uint8Array(digest))
  const expected = `v0=${hash}`

  return timingSafeEqual(expected, signature)
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  const diff = Array.from(a).reduce((acc, char, index) => acc | (char.charCodeAt(0) ^ b.charCodeAt(index)), 0)
  return diff === 0
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")
}

async function saveToKv(env: Env, key: string, session: SessionData): Promise<void> {
  await env.SESSIONS.put(key, JSON.stringify(session), {
    expiration: 60 * 60 * 24 * 7,
  })
}

async function getFromKv(env: Env, key: string): Promise<SessionData | null> {
  const cached = await env.SESSIONS.get(key)
  if (!cached) return null
  return JSON.parse(cached) as SessionData
}

function getNikcliUrl(env: Env): string | null {
  if (!env.NIKCLI_URL) return null
  return env.NIKCLI_URL.replace(/\/+$/, "")
}

function getAuthHeader(env: Env): { Authorization: string } | Record<string, never> {
  if (!env.NIKCLI_PASSWORD) return {}
  const username = env.NIKCLI_USERNAME || "nikcli"
  const token = btoa(`${username}:${env.NIKCLI_PASSWORD}`)
  return { Authorization: `Basic ${token}` }
}

function unwrapNikcliResponse<T>(value: NikcliResponse<T> | T): { data?: T; error?: string } {
  if (value && typeof value === "object" && "data" in value) {
    const wrapped = value as NikcliResponse<T>
    return { data: wrapped.data, error: wrapped.error }
  }
  return { data: value as T }
}
