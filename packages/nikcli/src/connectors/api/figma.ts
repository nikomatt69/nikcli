import { ConnectorAuth } from "../auth"
import { Effect, Schema } from "effect"
import { runPromiseWithLayer } from "@/effect"

export class FigmaApiError extends Schema.TaggedErrorClass<FigmaApiError>()("FigmaApiError", {
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

const FIGMA_API_BASE = "https://api.figma.com/v1"

export namespace FigmaApi {
  export async function getFile(token: string, fileKey: string): Promise<any> {
    const response = await fetch(`${FIGMA_API_BASE}/files/${fileKey}`, {
      headers: { "X-Figma-Token": token },
    })
    if (!response.ok) {
      throw new FigmaApiError({
        message: `Figma API error: ${response.status} ${response.statusText}`,
        status: response.status,
      })
    }
    return response.json()
  }

  export async function getFileComponents(token: string, fileKey: string): Promise<any> {
    const response = await fetch(`${FIGMA_API_BASE}/files/${fileKey}/components`, {
      headers: { "X-Figma-Token": token },
    })
    if (!response.ok) {
      throw new FigmaApiError({
        message: `Figma API error: ${response.status} ${response.statusText}`,
        status: response.status,
      })
    }
    return response.json()
  }

  export async function getFileStyles(token: string, fileKey: string): Promise<any> {
    const response = await fetch(`${FIGMA_API_BASE}/files/${fileKey}/styles`, {
      headers: { "X-Figma-Token": token },
    })
    if (!response.ok) {
      throw new FigmaApiError({
        message: `Figma API error: ${response.status} ${response.statusText}`,
        status: response.status,
      })
    }
    return response.json()
  }

  export async function getComments(token: string, fileKey: string): Promise<any> {
    const response = await fetch(`${FIGMA_API_BASE}/files/${fileKey}/comments`, {
      headers: { "X-Figma-Token": token },
    })
    if (!response.ok) {
      throw new FigmaApiError({
        message: `Figma API error: ${response.status} ${response.statusText}`,
        status: response.status,
      })
    }
    return response.json()
  }

  export async function getImage(token: string, fileKey: string, nodeIds: string[], scale: number = 2): Promise<any> {
    const response = await fetch(
      `${FIGMA_API_BASE}/images/${fileKey}?ids=${nodeIds.join(",")}&scale=${scale}&format=png`,
      {
        headers: { "X-Figma-Token": token },
      },
    )
    if (!response.ok) {
      throw new FigmaApiError({
        message: `Figma API error: ${response.status} ${response.statusText}`,
        status: response.status,
      })
    }
    return response.json()
  }

  export async function getTeamProjects(token: string, teamId: string): Promise<any> {
    const response = await fetch(`${FIGMA_API_BASE}/teams/${teamId}/projects`, {
      headers: { "X-Figma-Token": token },
    })
    if (!response.ok) {
      throw new FigmaApiError({
        message: `Figma API error: ${response.status} ${response.statusText}`,
        status: response.status,
      })
    }
    return response.json()
  }

  export async function getProjectFiles(token: string, projectId: string): Promise<any> {
    const response = await fetch(`${FIGMA_API_BASE}/projects/${projectId}/files`, {
      headers: { "X-Figma-Token": token },
    })
    if (!response.ok) {
      throw new FigmaApiError({
        message: `Figma API error: ${response.status} ${response.statusText}`,
        status: response.status,
      })
    }
    return response.json()
  }

  export async function getMe(token: string): Promise<any> {
    const response = await fetch(`${FIGMA_API_BASE}/me`, {
      headers: { "X-Figma-Token": token },
    })
    if (!response.ok) {
      throw new FigmaApiError({
        message: `Figma API error: ${response.status} ${response.statusText}`,
        status: response.status,
      })
    }
    return response.json()
  }

  export async function getNode(token: string, fileKey: string, nodeId: string): Promise<any> {
    const response = await fetch(`${FIGMA_API_BASE}/files/${fileKey}/nodes?ids=${nodeId}`, {
      headers: { "X-Figma-Token": token },
    })
    if (!response.ok) {
      throw new FigmaApiError({
        message: `Figma API error: ${response.status} ${response.statusText}`,
        status: response.status,
      })
    }
    return response.json()
  }
}

export async function getToken(name: string): Promise<string | null> {
  const auth = await connectorAuthGet(name)
  return auth?.token ?? null
}
