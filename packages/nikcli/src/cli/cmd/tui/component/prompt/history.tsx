import path from "path"
import { Global } from "@/global"
import { onMount } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { clone } from "remeda"
import { createSimpleContext } from "../../context/helper"
import type { AgentPart, FilePart, TextPart } from "@nikcli-ai/sdk/v2"

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

export const { use: usePromptHistory, provider: PromptHistoryProvider } = createSimpleContext({
  name: "PromptHistory",
  init: () => {
    const historyFile = Bun.file(path.join(Global.Path.state, "prompt-history.jsonl"))
    const writeHistory = (history: PromptInfo[]) => {
      const content = history.map((line) => JSON.stringify(line)).join("\n") + (history.length > 0 ? "\n" : "")
      Bun.write(historyFile, content).catch(() => {})
    }

    onMount(async () => {
      const text = await historyFile.text().catch(() => "")
      const lines = text
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

      setStore("history", lines)

      // Rewrite file with only valid entries to self-heal corruption
      if (lines.length > 0) {
        writeHistory(lines)
      }
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

        // Skip duplicate consecutive entries
        const last = store.history[0]
        if (last && last.input === entry.input) return

        // Skip entries containing sensitive patterns
        const sensitivePattern = /password\s*=|token\s*=|--api-key\s*=|Bearer\s+/i
        if (sensitivePattern.test(entry.input)) return

        setStore(
          produce((draft) => {
            draft.history.unshift(entry)
            if (draft.history.length > MAX_HISTORY_ENTRIES) {
              draft.history = draft.history.slice(0, MAX_HISTORY_ENTRIES)
            }
            draft.index = 0
          }),
        )

        writeHistory(store.history)
      },
    }
  },
})
