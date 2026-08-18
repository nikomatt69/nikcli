import { ConnectorAuth } from "../auth"
import { Effect, Schema } from "effect"
import { runPromiseWithLayer } from "@/effect"

export class SlackApiError extends Schema.TaggedErrorClass<SlackApiError>()("SlackApiError", {
  message: Schema.String,
}) {}

function connectorAuthGet(name: string) {
  return runPromiseWithLayer(
    ConnectorAuth.defaultLayer,
    Effect.gen(function* () {
      const auth = yield* ConnectorAuth.Service
      return yield* auth.get(name)
    }),
  )
}

const SLACK_API_BASE = "https://slack.com/api"

export namespace SlackApi {
  export async function sendMessage(botToken: string, channel: string, text: string, blocks?: any[]): Promise<any> {
    const body: any = { channel, text }
    if (blocks) body.blocks = blocks

    const response = await fetch(`${SLACK_API_BASE}/chat.postMessage`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${botToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    })
    const result = await response.json()
    if (!result.ok) {
      throw new SlackApiError({ message: `Slack API error: ${result.error}` })
    }
    return result
  }

  export async function getConversationInfo(botToken: string, channel: string): Promise<any> {
    const response = await fetch(`${SLACK_API_BASE}/conversations.info?channel=${channel}`, {
      headers: { Authorization: `Bearer ${botToken}` },
    })
    const result = await response.json()
    if (!result.ok) {
      throw new SlackApiError({ message: `Slack API error: ${result.error}` })
    }
    return result
  }

  export async function listConversations(botToken: string, types?: string): Promise<any> {
    const url = types ? `${SLACK_API_BASE}/conversations.list?types=${types}` : `${SLACK_API_BASE}/conversations.list`
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${botToken}` },
    })
    const result = await response.json()
    if (!result.ok) {
      throw new SlackApiError({ message: `Slack API error: ${result.error}` })
    }
    return result
  }

  export async function searchMessages(botToken: string, query: string, count: number = 20): Promise<any> {
    const response = await fetch(
      `${SLACK_API_BASE}/search.messages?query=${encodeURIComponent(query)}&count=${count}`,
      {
        headers: { Authorization: `Bearer ${botToken}` },
      },
    )
    const result = await response.json()
    if (!result.ok) {
      throw new SlackApiError({ message: `Slack API error: ${result.error}` })
    }
    return result
  }

  export async function getPermalink(botToken: string, channel: string, timestamp: string): Promise<any> {
    const response = await fetch(`${SLACK_API_BASE}/chat.getPermalink?channel=${channel}&message_ts=${timestamp}`, {
      headers: { Authorization: `Bearer ${botToken}` },
    })
    const result = await response.json()
    if (!result.ok) {
      throw new SlackApiError({ message: `Slack API error: ${result.error}` })
    }
    return result
  }

  export async function replyToMessage(
    botToken: string,
    channel: string,
    threadTs: string,
    text: string,
  ): Promise<any> {
    const response = await fetch(`${SLACK_API_BASE}/chat.postMessage`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${botToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ channel, text, thread_ts: threadTs }),
    })
    const result = await response.json()
    if (!result.ok) {
      throw new SlackApiError({ message: `Slack API error: ${result.error}` })
    }
    return result
  }

  export async function uploadFile(
    botToken: string,
    channels: string,
    fileData: Uint8Array,
    filename: string,
  ): Promise<any> {
    const formData = new FormData()
    formData.append("channels", channels)
    // SAFETY: `fileData` is a `Uint8Array` this process built from a file read
    // or a fetch body, so its backing store is an `ArrayBuffer` — the
    // `SharedArrayBuffer` half of `ArrayBufferLike` cannot occur here.
    formData.append("file", new Blob([fileData.buffer as ArrayBuffer]), filename)
    formData.append("filename", filename)

    const response = await fetch(`${SLACK_API_BASE}/files.upload`, {
      method: "POST",
      headers: { Authorization: `Bearer ${botToken}` },
      body: formData,
    })
    const result = await response.json()
    if (!result.ok) {
      throw new SlackApiError({ message: `Slack API error: ${result.error}` })
    }
    return result
  }

  export async function listUsers(botToken: string): Promise<any> {
    const response = await fetch(`${SLACK_API_BASE}/users.list`, {
      headers: { Authorization: `Bearer ${botToken}` },
    })
    const result = await response.json()
    if (!result.ok) {
      throw new SlackApiError({ message: `Slack API error: ${result.error}` })
    }
    return result
  }
}

export async function getBotToken(name: string): Promise<string | null> {
  const auth = await connectorAuthGet(name)
  return auth?.botToken ?? null
}

export async function getTeamId(name: string): Promise<string | null> {
  const auth = await connectorAuthGet(name)
  return auth?.teamId ?? null
}
