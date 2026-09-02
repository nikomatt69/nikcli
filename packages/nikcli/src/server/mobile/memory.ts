import { PromptStashStore } from "@nikcli-ai/util/prompt-stash"
import { MobilePromptStashCreateInput, listPromptHistory, listPromptStash, searchPromptMemories } from "./helpers"
import { MobileHttpError } from "./request"

export async function history() {
  // `listPromptHistory` narrows `mode` to these literals at runtime; the cast
  // only pins the type the contract declares.
  return (await listPromptHistory()) as unknown as Array<{
    id: string
    input: string
    mode: "normal" | "shell" | undefined
    partsCount: number
  }>
}

export function search(query: string) {
  return searchPromptMemories(query)
}

export function stashList() {
  return listPromptStash()
}

export async function stashCreate(input: typeof MobilePromptStashCreateInput._output) {
  const [entry] = (await PromptStashStore.push({ input: input.input.trim(), parts: [] })).slice(-1)
  return { id: entry.id, input: entry.input, timestamp: entry.timestamp, partsCount: 0 }
}

export async function stashDelete(id: string) {
  const current = await PromptStashStore.list()
  const next = await PromptStashStore.removeByID(id)
  if (next.length === current.length) throw new MobileHttpError("Prompt snippet not found", 404)
  return { success: true as const }
}
