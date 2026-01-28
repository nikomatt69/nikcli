import { App } from "@slack/bolt"
import { createNikcli, type ToolPart } from "@nikcli-ai/sdk"
import fs from "fs"
import path from "path"
import os from "os"

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN,
})

console.log("🔧 Bot configuration:")
console.log("- Bot token present:", !!process.env.SLACK_BOT_TOKEN)
console.log("- Signing secret present:", !!process.env.SLACK_SIGNING_SECRET)
console.log("- App token present:", !!process.env.SLACK_APP_TOKEN)

console.log("🚀 Starting nikcli server...")
const nikcli = await createNikcli({
  port: 0,
})
console.log("✅ Nikcli server ready")

const sessions = new Map<string, { client: any; server: any; sessionId: string; channel: string; thread: string }>()
const processingFiles = new Set<string>()

async function transcribeAudio(audioUrl: string): Promise<string> {
  const tempDir = os.tmpdir()
  const tempFile = path.join(tempDir, `voice_${Date.now()}.ogg`)

  console.log("📥 Downloading audio file...")

  try {
    const response = await fetch(audioUrl, {
      headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` },
    })

    if (!response.ok) {
      throw new Error(`Failed to download audio: ${response.statusText}`)
    }

    const arrayBuffer = await response.arrayBuffer()
    fs.writeFileSync(tempFile, Buffer.from(arrayBuffer))
    console.log("💾 Saved audio to:", tempFile)

    const transcription = await transcribeWithWhisper(tempFile)
    console.log("📝 Transcription:", transcription)
    return transcription
  } finally {
    try {
      fs.unlinkSync(tempFile)
    } catch {}
  }
}

async function transcribeWithWhisper(audioPath: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY

  if (!apiKey) {
    console.log("⚠️ No OPENAI_API_KEY, using basic fallback transcription")
    return "[Audio message - manual transcription required]"
  }

  console.log("🎙️ Transcribing with Whisper...")

  const audioBuffer = fs.readFileSync(audioPath)
  const audioBlob = new Blob([audioBuffer.buffer as ArrayBuffer], { type: "audio/ogg" })

  const formData = new FormData()
  formData.append("file", audioBlob, "voice.ogg")
  formData.append("model", "whisper-1")
  formData.append("language", "en")

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
  })

  if (!response.ok) {
    const error = await response.text()
    console.error("❌ Whisper API error:", error)
    return "[Transcription failed - check API key]"
  }

  const result = (await response.json()) as any
  return result.text || "[No transcription result]"
}

async function handleToolUpdate(part: ToolPart, channel: string, thread: string) {
  if (part.state.status !== "completed") return
  const toolMessage = `*${part.tool}* - ${part.state.title}`
  await app.client.chat
    .postMessage({
      channel,
      thread_ts: thread,
      text: toolMessage,
    })
    .catch(() => {})
}

async function sendToNikcli(session: any, text: string, channel: string, thread: string, say: any) {
  console.log("📝 Sending to nikcli:", text)

  const result = await session.client.session.prompt({
    path: { id: session.sessionId },
    body: { parts: [{ type: "text", text }] },
  })

  console.log("📤 Nikcli response:", JSON.stringify(result, null, 2))

  if (result.error) {
    console.error("❌ Failed to send message:", result.error)
    await say({
      text: "Sorry, I had trouble processing your message. Please try again.",
      thread_ts: thread,
    })
    return
  }

  const response = result.data

  const responseText =
    response.info?.content ||
    response.parts
      ?.filter((p: any) => p.type === "text")
      .map((p: any) => p.text)
      .join("\n") ||
    "I received your message but didn't have a response."

  console.log("💬 Sending response:", responseText)

  await say({ text: responseText, thread_ts: thread })
}

async function getOrCreateSession(channel: string, thread: string, say: any): Promise<any> {
  const sessionKey = `${channel}-${thread}`
  let session = sessions.get(sessionKey)

  if (!session) {
    console.log("🆕 Creating new nikcli session...")
    const { client, server } = nikcli

    const createResult = await client.session.create({
      body: { title: `Slack thread ${thread}` },
    })

    if (createResult.error) {
      console.error("❌ Failed to create session:", createResult.error)
      await say({
        text: "Sorry, I had trouble creating a session. Please try again.",
        thread_ts: thread,
      })
      return null
    }

    console.log("✅ Created nikcli session:", createResult.data.id)

    session = { client, server, sessionId: createResult.data.id, channel, thread }
    sessions.set(sessionKey, session)

    const shareResult = await client.session.share({ path: { id: createResult.data.id } })
    if (!shareResult.error && shareResult.data) {
      const sessionUrl = shareResult.data.share?.url!
      console.log("🔗 Session shared:", sessionUrl)
      await app.client.chat.postMessage({ channel, thread_ts: thread, text: sessionUrl })
    }
  }

  return session
}

app.event("message", async ({ event, say }) => {
  const message = event as any

  console.log("📨 Received message event:", JSON.stringify(message, null, 2))

  const channel = message.channel
  const thread = message.thread_ts || message.ts

  if (message.subtype === "file_share") {
    console.log("📎 File shared in thread")

    const file = message.files?.[0]
    if (!file) {
      console.log("⏭️ No file in message")
      return
    }

    const fileId = file.id
    if (processingFiles.has(fileId)) {
      console.log("⏭️ Already processing this file")
      return
    }
    processingFiles.add(fileId)

    try {
      const audioExtensions = [".mp3", ".ogg", ".wav", ".m4a", ".webm", ".mp4"]
      const isAudio =
        file.filetype && audioExtensions.some((ext) => file.filetype.includes(ext) || file.name?.endsWith(ext))

      if (!isAudio) {
        console.log("⏭️ Not an audio file, skipping")
        return
      }

      console.log("🎵 Audio file detected:", file.name)

      await say({
        text: "🎙️ Downloading and transcribing your voice message...",
        thread_ts: thread,
      })

      const transcription = await transcribeAudio(file.url_private)

      await say({
        text: `📝 *Transcription:*\n${transcription}`,
        thread_ts: thread,
      })

      const session = await getOrCreateSession(channel, thread, say)
      if (session) {
        await sendToNikcli(session, transcription, channel, thread, say)
      }
    } finally {
      processingFiles.delete(fileId)
    }

    return
  }

  if (message.subtype || !("text" in message) || !message.text) {
    console.log("⏭️ Skipping message - no text or has subtype")
    return
  }

  console.log("✅ Processing message:", message.text)

  const session = await getOrCreateSession(channel, thread, say)
  if (session) {
    await sendToNikcli(session, message.text, channel, thread, say)
  }
})

app.command("/test", async ({ command, ack, say }) => {
  await ack()
  console.log("🧪 Test command received:", JSON.stringify(command, null, 2))
  await say("🤖 Bot is working! I can hear you loud and clear.")
})

await app.start()
console.log("⚡️ Slack bot is running!")
