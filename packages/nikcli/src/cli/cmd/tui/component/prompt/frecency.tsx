import path from "path"
import { Global } from "@/global"
import { onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { createSimpleContext } from "../../context/helper"
import { appendFile } from "fs/promises"

function calculateFrecency(entry?: { frequency: number; lastOpen: number }): number {
  if (!entry) return 0
  // 7-day half-life: weight = 1 / (1 + daysSince / 7)
  const daysSince = (Date.now() - entry.lastOpen) / 86400000 // ms per day
  const weight = 1 / (1 + daysSince / 7)
  return entry.frequency * weight
}

const MAX_FRECENCY_ENTRIES = 1000
const GC_INTERVAL = 100 // Trigger GC every N updates

export const { use: useFrecency, provider: FrecencyProvider } = createSimpleContext({
  name: "Frecency",
  init: () => {
    const frecencyFile = Bun.file(path.join(Global.Path.state, "frecency.jsonl"))
    onMount(async () => {
      const text = await frecencyFile.text().catch(() => "")
      const lines = text
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          try {
            return JSON.parse(line) as { path: string; frequency: number; lastOpen: number }
          } catch {
            return null
          }
        })
        .filter((line): line is { path: string; frequency: number; lastOpen: number } => line !== null)

      const latest = lines.reduce(
        (acc, entry) => {
          acc[entry.path] = entry
          return acc
        },
        {} as Record<string, { path: string; frequency: number; lastOpen: number }>,
      )

      const sorted = Object.values(latest)
        .sort((a, b) => b.lastOpen - a.lastOpen)
        .slice(0, MAX_FRECENCY_ENTRIES)

      setStore(
        "data",
        Object.fromEntries(
          sorted.map((entry) => [entry.path, { frequency: entry.frequency, lastOpen: entry.lastOpen }]),
        ),
      )

      if (sorted.length > 0) {
        const content = sorted.map((entry) => JSON.stringify(entry)).join("\n") + "\n"
        Bun.write(frecencyFile, content).catch(() => {})
      }
    })

    const [store, setStore] = createStore({
      data: {} as Record<string, { frequency: number; lastOpen: number }>,
    })

    let updateCount = 0
    let pendingGC = false

    function scheduleGC() {
      if (pendingGC) return
      pendingGC = true
      queueMicrotask(() => {
        pendingGC = false
        if (Object.keys(store.data).length > MAX_FRECENCY_ENTRIES) {
          const sorted = Object.entries(store.data)
            .sort(([, a], [, b]) => b.lastOpen - a.lastOpen)
            .slice(0, MAX_FRECENCY_ENTRIES)
          setStore("data", Object.fromEntries(sorted))
          const content = sorted.map(([path, entry]) => JSON.stringify({ path, ...entry })).join("\n") + "\n"
          Bun.write(frecencyFile, content).catch(() => {})
        }
      })
    }

    function normalizePath(baseDir: string, filePath: string): string {
      // Normalize to absolute path relative to workspace
      const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(baseDir, filePath)
      return path.normalize(absolute)
    }

    function updateFrecency(filePath: string, baseDirectory?: string) {
      const baseDir = baseDirectory ?? process.cwd()
      const normalizedPath = normalizePath(baseDir, filePath)
      const newEntry = {
        frequency: (store.data[normalizedPath]?.frequency || 0) + 1,
        lastOpen: Date.now(),
      }
      setStore("data", normalizedPath, newEntry)
      // Append-only write (no full rewrite on every update)
      appendFile(frecencyFile.name!, JSON.stringify({ path: normalizedPath, ...newEntry }) + "\n").catch(() => {})

      // Periodic GC instead of every update
      updateCount++
      if (updateCount % GC_INTERVAL === 0) {
        scheduleGC()
      }
    }

    return {
      getFrecency: (filePath: string, baseDirectory?: string) => {
        const baseDir = baseDirectory ?? process.cwd()
        const normalizedPath = normalizePath(baseDir, filePath)
        return calculateFrecency(store.data[normalizedPath])
      },
      updateFrecency,
      data: () => store.data,
    }
  },
})
