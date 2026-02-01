import { ConnectorAuth } from "../auth"

const LOVABLE_API_BASE = "https://api.lovable.dev/v1"

export namespace LovableApi {
  export async function getProjects(apiKey: string): Promise<any> {
    const response = await fetch(`${LOVABLE_API_BASE}/projects`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
    })
    if (!response.ok) {
      throw new Error(`Lovable API error: ${response.status} ${response.statusText}`)
    }
    return response.json()
  }

  export async function getProject(apiKey: string, projectId: string): Promise<any> {
    const response = await fetch(`${LOVABLE_API_BASE}/projects/${projectId}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
    })
    if (!response.ok) {
      throw new Error(`Lovable API error: ${response.status} ${response.statusText}`)
    }
    return response.json()
  }

  export async function getChats(apiKey: string, projectId: string): Promise<any> {
    const response = await fetch(`${LOVABLE_API_BASE}/projects/${projectId}/chats`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
    })
    if (!response.ok) {
      throw new Error(`Lovable API error: ${response.status} ${response.statusText}`)
    }
    return response.json()
  }

  export async function getChatMessages(apiKey: string, projectId: string, chatId: string): Promise<any> {
    const response = await fetch(`${LOVABLE_API_BASE}/projects/${projectId}/chats/${chatId}/messages`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
    })
    if (!response.ok) {
      throw new Error(`Lovable API error: ${response.status} ${response.statusText}`)
    }
    return response.json()
  }

  export async function sendMessage(apiKey: string, projectId: string, message: string, chatId?: string): Promise<any> {
    const response = await fetch(`${LOVABLE_API_BASE}/projects/${projectId}/chats`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
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

  export async function getProjectFiles(apiKey: string, projectId: string): Promise<any> {
    const response = await fetch(`${LOVABLE_API_BASE}/projects/${projectId}/files`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
    })
    if (!response.ok) {
      throw new Error(`Lovable API error: ${response.status} ${response.statusText}`)
    }
    return response.json()
  }

  export async function getFileContent(apiKey: string, projectId: string, filePath: string): Promise<any> {
    const response = await fetch(
      `${LOVABLE_API_BASE}/projects/${projectId}/files/${encodeURIComponent(filePath)}/content`,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
        },
      },
    )
    if (!response.ok) {
      throw new Error(`Lovable API error: ${response.status} ${response.statusText}`)
    }
    return response.json()
  }

  export async function runPrompt(apiKey: string, projectId: string, prompt: string): Promise<any> {
    const response = await fetch(`${LOVABLE_API_BASE}/projects/${projectId}/prompts`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
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

export async function getApiKey(name: string): Promise<string | null> {
  const auth = await ConnectorAuth.get(name)
  return auth?.apiKey ?? null
}
