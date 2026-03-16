import { onMount } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { clone } from "remeda"
import { createSimpleContext } from "../../context/helper"
import type { PromptInfo } from "./history"
import { PromptStashStore, type StashEntry } from "@/prompt/stash-store"

export type { StashEntry } from "@/prompt/stash-store"

export const { use: usePromptStash, provider: PromptStashProvider } = createSimpleContext({
  name: "PromptStash",
  init: () => {
    onMount(async () => {
      const lines = await PromptStashStore.list()

      setStore("entries", lines)
    })

    const [store, setStore] = createStore({
      entries: [] as StashEntry[],
    })

    return {
      list() {
        return store.entries
      },
      push(entry: Omit<StashEntry, "timestamp" | "id">) {
        const stash = clone({
          ...entry,
          id: `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          timestamp: Date.now(),
        })
        setStore(
          produce((draft) => {
            draft.entries.push(stash)
          }),
        )
        void PromptStashStore.push(stash).then((entries) => setStore("entries", entries))
      },
      pop() {
        if (store.entries.length === 0) return undefined
        const entry = store.entries[store.entries.length - 1]
        setStore(
          produce((draft) => {
            draft.entries.pop()
          }),
        )
        void PromptStashStore.removeByID(entry.id).then((entries) => setStore("entries", entries))
        return entry
      },
      remove(index: number) {
        if (index < 0 || index >= store.entries.length) return
        const entry = store.entries[index]
        setStore(
          produce((draft) => {
            draft.entries.splice(index, 1)
          }),
        )
        void PromptStashStore.removeByID(entry.id).then((entries) => setStore("entries", entries))
      },
    }
  },
})
