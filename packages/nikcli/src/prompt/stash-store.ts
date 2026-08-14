import path from "path"
import { appendFile, writeFile } from "fs/promises"
import { Global } from "@nikcli-ai/util/global"
import type { PromptInfo } from "@/cli/cmd/tui/component/prompt/history"
import { capPromptEntryBytes, dehydratePromptEntry } from "@nikcli-ai/util/prompt-blob"

export type StashEntry = {
  id: string
  input: string
  parts: PromptInfo["parts"]
  timestamp: number
}

const MAX_STASH_ENTRIES = 50
let writeQueue = Promise.resolve()

function filePath() {
  return path.join(Global.Path.state, "prompt-stash.jsonl")
}

async function read() {
  const text = await Bun.file(filePath())
    .text()
    .catch(() => "")
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as Partial<StashEntry>
      } catch {
        return null
      }
    })
    .filter((line): line is Partial<StashEntry> => line !== null)
    .map((entry) => ({
      id: typeof entry.id === "string" && entry.id ? entry.id : String(entry.timestamp ?? Date.now()),
      input: typeof entry.input === "string" ? entry.input : "",
      parts: Array.isArray(entry.parts) ? (entry.parts as PromptInfo["parts"]) : [],
      timestamp: typeof entry.timestamp === "number" ? entry.timestamp : Date.now(),
    }))
    .slice(-MAX_STASH_ENTRIES)
}

async function persistLine(entry: StashEntry): Promise<string> {
  const dehydrated = capPromptEntryBytes(await dehydratePromptEntry(entry))
  return JSON.stringify(dehydrated)
}

async function rewrite(entries: StashEntry[]) {
  const lines = await Promise.all(entries.map((entry) => persistLine(entry)))
  const content = lines.length ? `${lines.join("\n")}\n` : ""
  await writeFile(filePath(), content)
}

function enqueue<T>(fn: () => Promise<T>) {
  const next = writeQueue.then(fn)
  writeQueue = next.then(
    () => undefined,
    () => undefined,
  )
  return next
}

export namespace PromptStashStore {
  export async function list() {
    return read()
  }

  export async function push(
    entry: Omit<StashEntry, "id" | "timestamp"> & {
      id?: string
      timestamp?: number
    },
  ) {
    return enqueue(async () => {
      const current = await read()
      const next: StashEntry = {
        id: entry.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        input: entry.input,
        parts: entry.parts,
        timestamp: entry.timestamp ?? Date.now(),
      }
      const entries = [...current, next].slice(-MAX_STASH_ENTRIES)
      const line = await persistLine(next)
      if (current.length + 1 === entries.length) {
        await appendFile(filePath(), `${line}\n`).catch(async () => {
          await rewrite(entries)
        })
      } else {
        await rewrite(entries)
      }
      return entries
    })
  }

  export async function removeByID(id: string) {
    return enqueue(async () => {
      const current = await read()
      const next = current.filter((entry) => entry.id !== id)
      if (next.length === current.length) return current
      await rewrite(next)
      return next
    })
  }
}
