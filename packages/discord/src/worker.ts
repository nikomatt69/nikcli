/**
 * Cloudflare Worker for Discord **Interactions** (HTTP webhook).
 *
 * This is the Cloudflare-deployable half of the Discord integration. The
 * Gateway bot in `src/bot.ts` needs a persistent websocket, a git working copy
 * and a child `nikcli serve` process, none of which a Worker can host — so it
 * stays on Railway. What runs here is the slash-command surface Discord can
 * reach over plain HTTP:
 *
 *   POST /discord/interactions   Ed25519-verified interaction endpoint
 *   GET  /health                 liveness + configuration probe
 *
 * The Worker owns no agent: it forwards the prompt to a nikcli server
 * (`NIKCLI_URL`) the way `packages/slack/src/worker.ts` does. Per-channel state
 * lives in a Durable Object rather than KV so that two interactions racing in
 * the same channel cannot each create their own nikcli session — the DO's input
 * gate serializes them onto one.
 */

import { DurableObject } from "cloudflare:workers"

interface Env {
  DISCORD_PUBLIC_KEY: string
  DISCORD_APPLICATION_ID: string
  DISCORD_BOT_TOKEN?: string
  NIKCLI_URL: string
  NIKCLI_TOKEN?: string
  NIKCLI_USERNAME?: string
  NIKCLI_PASSWORD?: string
  NIKCLI_TIMEOUT_MS?: string
  DISCORD_ALLOWED_CHANNELS?: string
  CHANNEL_SESSIONS: DurableObjectNamespace<ChannelSession>
}

/** https://discord.com/developers/docs/interactions/receiving-and-responding */
const InteractionType = {
  PING: 1,
  APPLICATION_COMMAND: 2,
} as const

const InteractionResponseType = {
  PONG: 1,
  CHANNEL_MESSAGE_WITH_SOURCE: 4,
  DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE: 5,
} as const

const EPHEMERAL = 1 << 6

const DISCORD_API = "https://discord.com/api/v10"
const DISCORD_MESSAGE_LIMIT = 2000
const REQUEST_TIMEOUT_MS = 120_000

interface Interaction {
  type: number
  id: string
  token: string
  application_id: string
  channel_id?: string
  guild_id?: string
  member?: { user?: { id: string } }
  user?: { id: string }
  data?: {
    name?: string
    options?: { name: string; value?: string }[]
  }
}

interface NikcliResponse<T = unknown> {
  error?: string
  data?: T
}

interface NikcliSessionInfo {
  id: string
  share?: { url: string }
}

interface NikcliMessagePart {
  type: string
  text?: string
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === "/health") {
      return json({
        status: "healthy",
        timestamp: Date.now(),
        nikcliUrl: env.NIKCLI_URL || "not configured",
        nikcliAuth: env.NIKCLI_TOKEN ? "bearer" : env.NIKCLI_PASSWORD ? "basic" : "none",
        publicKey: env.DISCORD_PUBLIC_KEY ? "configured" : "not configured",
        applicationId: env.DISCORD_APPLICATION_ID ? "configured" : "not configured",
      })
    }

    if (url.pathname === "/discord/interactions") {
      return handleInteraction(request, env, ctx)
    }

    return new Response("Not Found", { status: 404 })
  },
}

async function handleInteraction(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 })
  }

  const body = await request.text()

  // Discord probes this endpoint with deliberately bad signatures when you save
  // the Interactions URL; it must answer 401, not 400 or 500.
  const verified = await verifyDiscordRequest(request, body, env.DISCORD_PUBLIC_KEY)
  if (!verified) {
    return new Response("Invalid request signature", { status: 401 })
  }

  let interaction: Interaction
  try {
    interaction = JSON.parse(body) as Interaction
  } catch {
    return new Response("Bad Request", { status: 400 })
  }

  if (interaction.type === InteractionType.PING) {
    return json({ type: InteractionResponseType.PONG })
  }

  if (interaction.type !== InteractionType.APPLICATION_COMMAND) {
    return json({ type: InteractionResponseType.PONG })
  }

  const channel = interaction.channel_id
  if (!channel) {
    return reply("This command only works inside a channel.")
  }

  if (!isChannelAllowed(env, channel)) {
    return reply("This bot is not enabled in this channel.")
  }

  const prompt = interaction.data?.options?.find((option) => option.name === "prompt")?.value?.trim()
  if (!prompt) {
    return reply("Give me something to work on: `/nikcli prompt:<your request>`")
  }

  if (!getNikcliUrl(env)) {
    return reply("NIKCLI_URL is not configured on this Worker.")
  }

  // Discord kills the interaction after 3 seconds, so acknowledge now and let
  // the channel's Durable Object edit the deferred message when nikcli answers.
  const stub = env.CHANNEL_SESSIONS.get(env.CHANNEL_SESSIONS.idFromName(channel))
  ctx.waitUntil(
    stub
      .run(prompt, {
        token: interaction.token,
        applicationId: env.DISCORD_APPLICATION_ID || interaction.application_id,
        channel,
      })
      .catch((err: unknown) => {
        console.error("Interaction failed:", err)
      }),
  )

  return json({ type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE })
}

export interface InteractionRef {
  token: string
  applicationId: string
  channel: string
}

/**
 * One instance per Discord channel. Holds the nikcli session id for that
 * channel and runs the prompts against it. Because a Durable Object handles one
 * request at a time, prompts in the same channel queue behind each other
 * instead of forking separate sessions.
 */
export class ChannelSession extends DurableObject<Env> {
  async run(prompt: string, interaction: InteractionRef): Promise<void> {
    try {
      const sessionId = await this.sessionId(interaction.channel)
      if (!sessionId) {
        await editOriginal(interaction, "Couldn't create a nikcli session.")
        return
      }

      const answer = await this.sendPrompt(sessionId, prompt)
      await editOriginal(interaction, answer)
    } catch (err) {
      console.error("Prompt run failed:", err)
      await editOriginal(interaction, "Something went wrong while processing that request.")
    }
  }

  /** Returns the channel's nikcli session, creating it on first use. */
  private async sessionId(channel: string): Promise<string | null> {
    const existing = await this.ctx.storage.get<string>("sessionId")
    if (existing) return existing

    const nikcliUrl = getNikcliUrl(this.env)
    if (!nikcliUrl) return null

    const response = await nikcliFetch(this.env, `${nikcliUrl}/session`, {
      method: "POST",
      body: JSON.stringify({ title: `Discord channel ${channel}` }),
    })

    if (!response?.ok) {
      console.error("Failed to create session:", response ? await response.text() : "request failed")
      return null
    }

    const created = unwrapNikcliResponse((await response.json()) as NikcliResponse<NikcliSessionInfo>)
    if (created.error || !created.data?.id) {
      console.error("Failed to create session:", created.error)
      return null
    }

    await this.ctx.storage.put("sessionId", created.data.id)
    await this.ctx.storage.put("createdAt", Date.now())
    return created.data.id
  }

  private async sendPrompt(sessionId: string, text: string): Promise<string> {
    const nikcliUrl = getNikcliUrl(this.env)
    if (!nikcliUrl) return "NIKCLI_URL is not configured on this Worker."

    const response = await nikcliFetch(this.env, `${nikcliUrl}/session/${sessionId}/message`, {
      method: "POST",
      body: JSON.stringify({ parts: [{ type: "text", text }] }),
    })

    if (!response) return "Request timed out."
    if (!response.ok) {
      console.error("Prompt error:", await response.text())
      return "Error processing request."
    }

    const result = unwrapNikcliResponse(
      (await response.json()) as NikcliResponse<{
        info?: { content: string }
        content?: string
        parts?: NikcliMessagePart[]
      }>,
    )

    if (result.error) {
      console.error("Prompt error:", result.error)
      return "Error processing request."
    }

    return extractResponseText(result.data)
  }
}

function extractResponseText(data?: {
  info?: { content: string }
  content?: string
  parts?: NikcliMessagePart[]
}): string {
  if (!data) return "I received your message."
  if (data.info?.content) return data.info.content
  if (data.content) return data.content

  const textParts = data.parts?.filter((part) => part.type === "text").map((part) => part.text || "")
  if (textParts?.length && textParts.some((text) => text)) return textParts.join("\n")

  return "I received your message."
}

/**
 * Edits the deferred response, then posts the overflow as follow-up messages —
 * Discord rejects any single message body over 2000 characters.
 */
async function editOriginal(interaction: InteractionRef, content: string): Promise<void> {
  const base = `${DISCORD_API}/webhooks/${interaction.applicationId}/${interaction.token}`
  const chunks = chunk(content, DISCORD_MESSAGE_LIMIT)

  const first = await fetch(`${base}/messages/@original`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: chunks[0] }),
  })
  if (!first.ok) console.error("Failed to edit interaction response:", await first.text())

  for (const rest of chunks.slice(1)) {
    const followup = await fetch(base, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: rest }),
    })
    if (!followup.ok) console.error("Failed to post follow-up:", await followup.text())
  }
}

function chunk(text: string, size: number): string[] {
  const value = text.trim() || "I received your message."
  if (value.length <= size) return [value]

  const chunks: string[] = []
  for (let index = 0; index < value.length; index += size) {
    chunks.push(value.slice(index, index + size))
  }
  return chunks
}

/**
 * https://discord.com/developers/docs/interactions/overview#setting-up-an-endpoint
 * The signed payload is `timestamp + rawBody`, so the body must be read as text
 * before it is parsed.
 */
async function verifyDiscordRequest(request: Request, body: string, publicKey: string): Promise<boolean> {
  if (!publicKey) return false

  const signature = request.headers.get("X-Signature-Ed25519")
  const timestamp = request.headers.get("X-Signature-Timestamp")
  if (!signature || !timestamp) return false

  const signatureBytes = fromHex(signature)
  const keyBytes = fromHex(publicKey)
  if (!signatureBytes || !keyBytes) return false

  const key = await importEd25519Key(keyBytes)
  if (!key) return false

  try {
    return await crypto.subtle.verify(
      key.algorithm,
      key.key,
      signatureBytes as unknown as ArrayBuffer,
      new TextEncoder().encode(timestamp + body) as unknown as ArrayBuffer,
    )
  } catch (err) {
    console.error("Signature verification failed:", err)
    return false
  }
}

/**
 * Workers accepted Ed25519 under the non-standard `NODE-ED25519` name before
 * the standard one landed; try the standard name first and fall back.
 */
async function importEd25519Key(
  keyBytes: Uint8Array,
): Promise<{ key: CryptoKey; algorithm: AlgorithmIdentifier } | null> {
  const candidates: AlgorithmIdentifier[] = [
    { name: "Ed25519" } as AlgorithmIdentifier,
    { name: "NODE-ED25519", namedCurve: "NODE-ED25519" } as unknown as AlgorithmIdentifier,
  ]

  for (const algorithm of candidates) {
    try {
      const key = await crypto.subtle.importKey("raw", keyBytes as unknown as ArrayBuffer, algorithm, false, [
        "verify",
      ])
      return { key, algorithm }
    } catch {
      // try the next spelling
    }
  }

  console.error("Runtime does not support Ed25519 key import")
  return null
}

function fromHex(value: string): Uint8Array | null {
  if (value.length % 2 !== 0 || /[^0-9a-fA-F]/.test(value)) return null

  const bytes = new Uint8Array(value.length / 2)
  for (let index = 0; index < bytes.length; index++) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16)
  }
  return bytes
}

async function nikcliFetch(env: Env, url: string, init: RequestInit): Promise<Response | null> {
  const timeout = Number(env.NIKCLI_TIMEOUT_MS) || REQUEST_TIMEOUT_MS
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)

  try {
    return await fetch(url, {
      ...init,
      headers: { "Content-Type": "application/json", ...getAuthHeader(env) },
      signal: controller.signal,
    })
  } catch (err) {
    console.error("nikcli request failed:", err)
    return null
  } finally {
    clearTimeout(timeoutId)
  }
}

function isChannelAllowed(env: Env, channel: string): boolean {
  const allowed = env.DISCORD_ALLOWED_CHANNELS?.split(",")
    .map((id) => id.trim())
    .filter(Boolean)
  if (!allowed?.length) return true
  return allowed.includes(channel)
}

function getNikcliUrl(env: Env): string | null {
  if (!env.NIKCLI_URL) return null
  return env.NIKCLI_URL.replace(/\/+$/, "")
}

/**
 * A server started with `nikcli mobile serve` sets `mobileAuthRequired`, which
 * rejects Basic auth outright and accepts only a bearer — a mobile pairing
 * token, an external session, or an `nku_` user token. A plain `nikcli serve`
 * takes Basic. Prefer the bearer when both are configured.
 */
function getAuthHeader(env: Env): { Authorization: string } | Record<string, never> {
  if (env.NIKCLI_TOKEN) return { Authorization: `Bearer ${env.NIKCLI_TOKEN}` }
  if (!env.NIKCLI_PASSWORD) return {}
  const username = env.NIKCLI_USERNAME || "nikcli"
  return { Authorization: `Basic ${btoa(`${username}:${env.NIKCLI_PASSWORD}`)}` }
}

function unwrapNikcliResponse<T>(value: NikcliResponse<T> | T): { data?: T; error?: string } {
  if (value && typeof value === "object" && "data" in value) {
    const wrapped = value as NikcliResponse<T>
    return { data: wrapped.data, error: wrapped.error }
  }
  return { data: value as T }
}

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } })
}

function reply(content: string): Response {
  return json({
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: { content, flags: EPHEMERAL },
  })
}
