import { App, type SayFn } from "@slack/bolt"
import { createNikcli, type Part, type TextPart, type ToolPart, type ToolStateCompleted } from "@nikcli-ai/sdk"

type Session = {
  sessionId: string
  channel: string
  thread: string
}

type SlackMessage = {
  channel: string
  ts: string
  thread_ts?: string
  text?: string
  subtype?: string
  channel_type?: string
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

console.log("Starting nikcli server...")
const nikcli = await createNikcli({
  port: 0,
  config: {
    model: "minimax-coding-plan/MiniMax-M2.5",
  },
})
console.log("Nikcli server ready")

const sessions = new Map<string, Session>()

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

// Background event subscription — posts tool completion updates into the thread
;(async () => {
  const events = await nikcli.client.event.subscribe()
  for await (const event of events.stream) {
    if (event.type === "message.part.updated") {
      const part = event.properties.part
      if (part.type === "tool" && part.state.status === "completed") {
        const toolPart = part as ToolPart
        const state = toolPart.state as ToolStateCompleted
        for (const session of sessions.values()) {
          if (session.sessionId === toolPart.sessionID) {
            app.client.chat
              .postMessage({
                channel: session.channel,
                thread_ts: session.thread,
                text: `*${toolPart.tool}* — ${state.title}`,
              })
              .catch(() => {})
            break
          }
        }
      }
    }
  }
})()

app.message(async (args) => {
  const message = args.message as SlackMessage

  if (message.subtype || !message.text) return

  const channel = message.channel
  const thread = message.thread_ts ?? message.ts
  const text = message.text
  const botId = typeof args.context?.botUserId === "string" ? args.context.botUserId : ""
  const direct = message.channel_type === "im" || message.channel_type === "mpim" || message.channel.startsWith("D")
  const mention = direct ? false : hasMention(text, botId)

  if (!direct && !mention) return

  const prompt = stripMention(text, botId)
  if (!prompt) {
    await args.say({ text: "Please include a prompt after mentioning me.", thread_ts: thread })
    return
  }

  console.log("Processing message:", prompt)

  const sessionKey = `${channel}-${thread}`
  const session = await getSession(sessionKey, channel, thread, args.say)
  if (!session) return

  // Post a "Thinking…" placeholder while the AI works
  const thinkingMsg = await app.client.chat
    .postMessage({ channel, thread_ts: thread, text: "Thinking…" })
    .catch(() => undefined)

  let responseText: string
  try {
    console.log("Sending to nikcli:", prompt)
    const result = await nikcli.client.session.prompt({
      path: { id: session.sessionId },
      body: { parts: [{ type: "text", text: prompt }] },
    })

    console.log("Nikcli response received")

    if (result.error) {
      console.error("Failed to get response:", result.error)
      responseText = "Sorry, I had trouble processing your message. Please try again."
    } else {
      responseText = extractResponseText(result.data)
    }
  } catch (err) {
    console.error("nikcli prompt exception:", err)
    responseText = "Sorry, I had trouble processing your message. Please try again."
  }

  // Delete the thinking placeholder, then post real response
  if (thinkingMsg?.ok && thinkingMsg.ts) {
    await app.client.chat.delete({ channel, ts: thinkingMsg.ts }).catch(() => {})
  }

  await args.say({ text: responseText, thread_ts: thread })
})

app.command("/test", async (args) => {
  await args.ack()
  console.log("Test command received:", JSON.stringify(args.command, null, 2))
  await args.say("Bot is working! I can hear you loud and clear.")
})

await app.start()
console.log("Slack bot is running!")

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

function extractResponseText(data?: { info?: unknown; parts?: Part[] } | null): string {
  if (!data) return "I received your message but had no response."
  const textParts = (data.parts ?? []).filter(isTextPart).map((p) => p.text).filter(Boolean)
  if (textParts.length) return textParts.join("\n")
  return "I received your message but had no response."
}

async function getSession(sessionKey: string, channel: string, thread: string, say: SayFn): Promise<Session | null> {
  const cached = sessions.get(sessionKey)
  if (cached) return cached

  console.log("Creating new nikcli session...")

  const createResult = await nikcli.client.session.create({
    body: { title: `Slack thread ${thread}` },
  })

  if (createResult.error || !createResult.data?.id) {
    console.error("Failed to create session:", createResult.error)
    await say({ text: "Sorry, I couldn't create a session. Please try again.", thread_ts: thread })
    return null
  }

  console.log("Created nikcli session:", createResult.data.id)

  const session: Session = { sessionId: createResult.data.id, channel, thread }
  sessions.set(sessionKey, session)

  // Share session URL into the thread
  const shareResult = await nikcli.client.session.share({
    path: { id: createResult.data.id },
  })
  if (!shareResult.error && shareResult.data?.share?.url) {
    const sessionUrl = shareResult.data.share.url
    console.log("Session shared:", sessionUrl)
    await app.client.chat.postMessage({ channel, thread_ts: thread, text: sessionUrl })
  }

  return session
}
