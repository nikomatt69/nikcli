interface Env {
  SLACK_BOT_TOKEN: string
  SLACK_SIGNING_SECRET: string
  OPENAI_API_KEY: string
  NIKCLI_URL: string
  NIKCLI_API_KEY: string
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === "/health") {
      return new Response(JSON.stringify({ status: "healthy" }), {
        headers: { "Content-Type": "application/json" },
      })
    }

    if (url.pathname === "/slack/events") {
      return handleSlackEvent(request, env)
    }

    if (url.pathname === "/slack/interactive") {
      return handleInteractive(request, env)
    }

    return new Response("Not Found", { status: 404 })
  },
} satisfies ExportedHandler<Env>

const sessions = new Map<string, { sessionId: string; channel: string; thread: string }>()
const processingFiles = new Set<string>()

async function handleSlackEvent(request: Request, env: Env): Promise<Response> {
  const body = (await request.json()) as any

  if (body.type === "url_verification") {
    return new Response(JSON.stringify({ challenge: body.challenge }))
  }

  if (body.type === "event_callback") {
    const event = body.event as any
    await processEvent(event, env)
  }

  return new Response("OK")
}

async function processEvent(event: any, env: Env) {
  if (event.subtype === "file_share") {
    await handleFileShare(event, env)
    return
  }

  if (!event.text) return

  const channel = event.channel
  const thread = event.thread_ts || event.ts
  const sessionKey = `${channel}-${thread}`

  let session = sessions.get(sessionKey)

  if (!session) {
    const nikcliUrl = env.NIKCLI_URL || "http://localhost:4000"
    const apiKey = env.NIKCLI_API_KEY || ""

    const createResult = await fetch(`${nikcliUrl}/v2/session`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey && { Authorization: `Bearer ${apiKey}` }),
      },
      body: JSON.stringify({ title: `Slack thread ${thread}` }),
    })
    const createData = (await createResult.json()) as any

    if (createData.error || !createData.data?.id) return

    session = { sessionId: createData.data.id, channel, thread }
    sessions.set(sessionKey, session)

    const shareResult = await fetch(`${nikcliUrl}/v2/session/${createData.data.id}/share`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey && { Authorization: `Bearer ${apiKey}` }),
      },
    })
    const shareData = (await shareResult.json()) as any

    if (!shareData.error && shareData.data?.share?.url) {
      await postMessage(env.SLACK_BOT_TOKEN, channel, thread, shareData.data.share.url)
    }
  }

  const nikcliUrl = env.NIKCLI_URL || "http://localhost:4000"
  const apiKey = env.NIKCLI_API_KEY || ""

  const result = await fetch(`${nikcliUrl}/v2/session/${session.sessionId}/prompt`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey && { Authorization: `Bearer ${apiKey}` }),
    },
    body: JSON.stringify({ parts: [{ type: "text", text: event.text }] }),
  })
  const resultData = (await result.json()) as any

  if (resultData.error) return

  const responseText =
    resultData.data?.info?.content ||
    resultData.data?.parts
      ?.filter((p: any) => p.type === "text")
      .map((p: any) => p.text)
      .join("\n") ||
    "I received your message."

  await postMessage(env.SLACK_BOT_TOKEN, channel, thread, responseText)
}

async function handleFileShare(event: any, env: Env) {
  const file = event.files?.[0]
  if (!file) return

  const fileId = file.id
  if (processingFiles.has(fileId)) return
  processingFiles.add(fileId)

  try {
    const audioExtensions = [".mp3", ".ogg", ".wav", ".m4a", ".webm", ".mp4"]
    const isAudio =
      file.filetype && audioExtensions.some((ext) => file.filetype.includes(ext) || file.name?.endsWith(ext))
    if (!isAudio) return

    await postMessage(
      env.SLACK_BOT_TOKEN,
      event.channel,
      event.thread_ts || event.ts,
      "🎙️ Downloading and transcribing...",
    )

    const transcription = await transcribeAudio(file.url_private, env.SLACK_BOT_TOKEN, env.OPENAI_API_KEY)

    await postMessage(
      env.SLACK_BOT_TOKEN,
      event.channel,
      event.thread_ts || event.ts,
      `📝 *Transcription:*\n${transcription}`,
    )

    await processEvent({ ...event, text: transcription }, env)
  } finally {
    processingFiles.delete(fileId)
  }
}

async function transcribeAudio(audioUrl: string, botToken: string, apiKey: string): Promise<string> {
  if (!apiKey) return "[Audio message - OPENAI_API_KEY not configured]"

  try {
    const response = await fetch(audioUrl, {
      headers: { Authorization: `Bearer ${botToken}` },
    })

    if (!response.ok) throw new Error(`Failed to download: ${response.statusText}`)

    const arrayBuffer = await response.arrayBuffer()
    const uint8Array = new Uint8Array(arrayBuffer)

    const audioBlob = new Blob([uint8Array], { type: "audio/ogg" })

    const formData = new FormData()
    formData.append("file", audioBlob, "voice.ogg")
    formData.append("model", "whisper-1")
    formData.append("language", "en")

    const whisperResponse = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: formData,
    })

    if (!whisperResponse.ok) {
      const error = await whisperResponse.text()
      console.error("Whisper error:", error)
      return "[Transcription failed]"
    }

    const whisperResult = (await whisperResponse.json()) as any
    return whisperResult.text || "[No transcription]"
  } catch (error) {
    console.error("Transcription error:", error)
    return `[Error: ${error}]`
  }
}

async function postMessage(token: string, channel: string, threadTs: string | undefined, text: string) {
  await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ channel, thread_ts: threadTs, text }),
  })
}

async function handleInteractive(request: Request, env: Env): Promise<Response> {
  const body = await request.formData()
  const payload = JSON.parse(body.get("payload") as string)

  return new Response("OK")
}
