import { ConnectorAuth } from "../auth"
import { Effect, Schema } from "effect"
import { runPromiseWithLayer } from "@/effect"

export class LovableApiError extends Schema.TaggedError<LovableApiError>()("LovableApiError", {
  message: Schema.String,
  status: Schema.optional(Schema.Number),
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

const LOVABLE_API_BASE = "https://api.lovable.dev/v1"

export namespace LovableApi {
  export async function getProjects(token: string): Promise<any> {
    const response = await fetch(`${LOVABLE_API_BASE}/projects`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    })
    if (!response.ok) {
      throw new Error(`Lovable API error: ${response.status} ${response.statusText}`)
    }
    return response.json()
  }

  export async function getProject(token: string, projectId: string): Promise<any> {
    const response = await fetch(`${LOVABLE_API_BASE}/projects/${projectId}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    })
    if (!response.ok) {
      throw new Error(`Lovable API error: ${response.status} ${response.statusText}`)
    }
    return response.json()
  }

  export async function getChats(token: string, projectId: string): Promise<any> {
    const response = await fetch(`${LOVABLE_API_BASE}/projects/${projectId}/chats`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    })
    if (!response.ok) {
      throw new Error(`Lovable API error: ${response.status} ${response.statusText}`)
    }
    return response.json()
  }

  export async function getChatMessages(token: string, projectId: string, chatId: string): Promise<any> {
    const response = await fetch(`${LOVABLE_API_BASE}/projects/${projectId}/chats/${chatId}/messages`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    })
    if (!response.ok) {
      throw new Error(`Lovable API error: ${response.status} ${response.statusText}`)
    }
    return response.json()
  }

  export async function sendMessage(token: string, projectId: string, message: string, chatId?: string): Promise<any> {
    const response = await fetch(`${LOVABLE_API_BASE}/projects/${projectId}/chats`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ message, chatId }),
    })
    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Lovable API error: ${response.status} - ${error}`)
    }
    return response.json()
  }

  export async function getProjectFiles(token: string, projectId: string): Promise<any> {
    const response = await fetch(`${LOVABLE_API_BASE}/projects/${projectId}/files`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    })
    if (!response.ok) {
      throw new Error(`Lovable API error: ${response.status} ${response.statusText}`)
    }
    return response.json()
  }

  export async function getFileContent(token: string, projectId: string, filePath: string): Promise<any> {
    const response = await fetch(
      `${LOVABLE_API_BASE}/projects/${projectId}/files/${encodeURIComponent(filePath)}/content`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
      },
    )
    if (!response.ok) {
      throw new Error(`Lovable API error: ${response.status} ${response.statusText}`)
    }
    return response.json()
  }

  export async function runPrompt(token: string, projectId: string, prompt: string): Promise<any> {
    const response = await fetch(`${LOVABLE_API_BASE}/projects/${projectId}/prompts`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prompt }),
    })
    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Lovable API error: ${response.status} - ${error}`)
    }
    return response.json()
  }
}

export async function getToken(name: string): Promise<string | null> {
  const auth = await connectorAuthGet(name)
  if (auth?.token) return auth.token
  return auth?.apiKey ?? null
}
