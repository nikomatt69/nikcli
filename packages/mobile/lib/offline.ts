import { AppState } from "react-native"
import * as SecureStore from "expo-secure-store"
import { getMobileClient } from "./client"

const QUEUE_KEY = "nikcli_offline_queue"
const MAX_ENTRIES = 50

type OfflineOp = {
  type: "sendMessage"
  sessionID: string
  text: string
  options?: { model?: { providerID: string; modelID: string }; agent?: string }
}

async function readQueue(): Promise<OfflineOp[]> {
  try {
    const raw = await SecureStore.getItemAsync(QUEUE_KEY)
    if (!raw) return []
    return JSON.parse(raw) as OfflineOp[]
  } catch {
    return []
  }
}

async function writeQueue(queue: OfflineOp[]): Promise<void> {
  try {
    await SecureStore.setItemAsync(QUEUE_KEY, JSON.stringify(queue))
  } catch {
    // SecureStore unavailable; queue persists in memory only for this session
  }
}

export async function enqueueOp(op: OfflineOp): Promise<void> {
  const queue = await readQueue()
  queue.push(op)
  // LRU eviction: keep last MAX_ENTRIES
  const trimmed = queue.length > MAX_ENTRIES ? queue.slice(queue.length - MAX_ENTRIES) : queue
  await writeQueue(trimmed)
}

export async function drainQueue(): Promise<void> {
  const client = await getMobileClient()
  if (!client) return
  const queue = await readQueue()
  if (!queue.length) return

  const remaining: OfflineOp[] = []
  for (const op of queue) {
    try {
      if (op.type === "sendMessage") {
        await client.sendMessage(op.sessionID, op.text, op.options)
      }
    } catch {
      remaining.push(op)
    }
  }
  await writeQueue(remaining)
}

export function setupOfflineDrainOnForeground(): () => void {
  let draining = false
  const subscription = AppState.addEventListener("change", (state) => {
    if (state === "active" && !draining) {
      draining = true
      drainQueue().finally(() => {
        draining = false
      })
    }
  })
  return () => subscription.remove()
}
