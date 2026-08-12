import path from "path"
import { Global } from "@/global"
import { onMount } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { clone } from "remeda"
import { createSimpleContext } from "../../context/helper"
import {
  capPromptEntryBytes,
  collectBlobIDsFromParts,
  dehydratePromptEntry,
  hydratePromptEntry,
  PromptBlob,
} from "../../util/prompt-blob"
import { PromptStashStore } from "@/prompt/stash-store"
import type { AgentPart, FilePart, TextPart } from "@nikcli-ai/sdk/httpapi"

export type PromptInfo = {
  input: string
  mode?: "normal" | "shell"
  parts: (
    | Omit<FilePart, "id" | "messageID" | "sessionID">
    | Omit<AgentPart, "id" | "messageID" | "sessionID">
    | (Omit<TextPart, "id" | "messageID" | "sessionID"> & {
        source?: {
          text: {
            start: number
            end: number
            value: string
          }
        }
      })
  )[]
}

const MAX_HISTORY_ENTRIES = 50
const BLOB_GC_TTL_MS = 14 * 24 * 60 * 60 * 1000

export const { use: usePromptHistory, provider: PromptHistoryProvider } = createSimpleContext({
  name: "PromptHistory",
  init: () => {
    const historyFile = Bun.file(path.join(Global.Path.state, "prompt-history.jsonl"))
    const writeHistory = (history: PromptInfo[]) => {
      // Strip base64 image payloads to the blob store, then bound each entry's size before
      // writing the JSONL so a huge paste can never balloon the file.
      void (async () => {
        const dehydrated = await Promise.all(
          history.map(async (e) => capPromptEntryBytes(await dehydratePromptEntry(e))),
        )
        const content = dehydrated.map((line) => JSON.stringify(line)).join("\n") + (dehydrated.length > 0 ? "\n" : "")
        await Bun.write(historyFile, content).catch(() => {})
      })()
    }

    onMount(async () => {
      const text = await historyFile.text().catch(() => "")
      const parsed = text
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          try {
            return JSON.parse(line)
          } catch {
            return null
          }
        })
        .filter((line): line is PromptInfo => line !== null)
        .slice(-MAX_HISTORY_ENTRIES)

      // Rebuild image dataUrls from blob refs so history navigation works without async hydration.
      const lines = (await Promise.all(parsed.map((e) => hydratePromptEntry(e)))) as PromptInfo[]

      setStore("history", lines)

      // Rewrite file with only valid entries to self-heal corruption
      if (lines.length > 0) {
        writeHistory(lines)
      }

      // Best-effort blob GC (local TUI domain — never surfaces as session.error)
      void (async () => {
        const referenced = new Set<string>()
        for (const entry of lines) collectBlobIDsFromParts(entry.parts).forEach((id) => referenced.add(id))
        const stash = await PromptStashStore.list().catch(() => [] as Awaited<ReturnType<typeof PromptStashStore.list>>)
        for (const entry of stash) collectBlobIDsFromParts(entry.parts).forEach((id) => referenced.add(id))
        await PromptBlob.gc(referenced, BLOB_GC_TTL_MS)
      })()
    })

    const [store, setStore] = createStore({
      index: 0,
      history: [] as PromptInfo[],
    })

    return {
      move(direction: 1 | -1, input: string) {
        if (!store.history.length) return undefined
        const current = store.history.at(store.index)
        if (!current) return undefined
        if (current.input !== input && input.length) return
        setStore(
          produce((draft) => {
            const next = store.index + direction
            if (Math.abs(next) > store.history.length) return
            if (next > 0) return
            draft.index = next
          }),
        )
        if (store.index === 0)
          return {
            input: "",
            parts: [],
          }
        return store.history.at(store.index)
      },
      append(item: PromptInfo) {
        const entry = clone(item)
        setStore(
          produce((draft) => {
            draft.history.push(entry)
            if (draft.history.length > MAX_HISTORY_ENTRIES) {
              draft.history = draft.history.slice(-MAX_HISTORY_ENTRIES)
            }
            draft.index = 0
          }),
        )

        writeHistory(store.history)
      },
    }
  },
})
