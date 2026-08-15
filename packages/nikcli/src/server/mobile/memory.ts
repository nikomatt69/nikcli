import z from "zod"
import { PromptStashStore } from "@nikcli-ai/util/prompt-stash"
import { MobilePromptStashCreateInput, listPromptHistory, listPromptStash, searchPromptMemories } from "./helpers"
import { body, isResponse, json, query } from "./request"

export async function handleMemoryRequest(request: Request): Promise<Response | undefined> {
  const path = new URL(request.url).pathname
  if (path === "/mobile/memory/history" && request.method === "GET") return json(await listPromptHistory())
  if (path === "/mobile/memory/search" && request.method === "GET") {
    const input = query(request, z.object({ query: z.string().trim().min(1) }))
    return isResponse(input) ? input : json(await searchPromptMemories(input.query))
  }
  if (path === "/mobile/memory/stash" && request.method === "GET") return json(await listPromptStash())
  if (path === "/mobile/memory/stash" && request.method === "POST") {
    const input = await body(request, MobilePromptStashCreateInput)
    if (isResponse(input)) return input
    const [entry] = (await PromptStashStore.push({ input: input.input.trim(), parts: [] })).slice(-1)
    return json({ id: entry.id, input: entry.input, timestamp: entry.timestamp, partsCount: 0 })
  }
  const match = path.match(/^\/mobile\/memory\/stash\/([^/]+)$/)
  if (match && request.method === "DELETE") {
    const current = await PromptStashStore.list()
    const next = await PromptStashStore.removeByID(decodeURIComponent(match[1]))
    return next.length === current.length ? json({ error: "Prompt snippet not found" }, 404) : json({ success: true })
  }
}
