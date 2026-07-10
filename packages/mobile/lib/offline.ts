import { AppState } from "react-native"
import * as SecureStore from "expo-secure-store"
import { getMobileClient } from "./client"
import { useUIStore } from "./store"

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

function syncQueueCount(queue: OfflineOp[]) {
  useUIStore.setState((state) => ({
    offlineQueueCount: queue.length,
    offlineQueueRevision: state.offlineQueueRevision + 1,
  }))
}

/** True when fetch failed because the device cannot reach the server (not HTTP/business errors). */
export function isOfflineSendError(error: unknown): boolean {
  if (!error) return false

  if (error instanceof TypeError) {
    const msg = error.message.toLowerCase()
    return msg.includes("network request failed") || msg.includes("failed to fetch")
  }

  if (error instanceof Error) {
    const msg = error.message.toLowerCase()
    if (msg.includes("request to") && msg.includes("failed with")) return false
    return (
      msg.includes("network request failed") ||
      msg.includes("failed to fetch") ||
      msg.includes("network error") ||
      msg.includes("timeout") ||
      msg.includes("timed out") ||
      msg.includes("could not connect") ||
      msg.includes("connection refused") ||
      msg.includes("internet connection") ||
      msg.includes("offline")
    )
  }

  return false
}

export async function refreshOfflineQueueCount(): Promise<number> {
  const queue = await readQueue()
  syncQueueCount(queue)
  return queue.length
}

export async function countOfflineQueueForSession(sessionID: string): Promise<number> {
  const queue = await readQueue()
  return queue.filter((op) => op.sessionID === sessionID).length
}

export async function enqueueOp(op: OfflineOp): Promise<void> {
  const queue = await readQueue()
  queue.push(op)
  const trimmed = queue.length > MAX_ENTRIES ? queue.slice(queue.length - MAX_ENTRIES) : queue
  await writeQueue(trimmed)
  syncQueueCount(trimmed)
}

export async function drainQueue(): Promise<void> {
  const client = await getMobileClient()
  if (!client) return
  const queue = await readQueue()
  if (!queue.length) {
    syncQueueCount([])
    return
  }

  const before = queue.length
  const results = await Promise.allSettled(
    queue.map(async (op) => {
      if (op.type === "sendMessage") {
        await client.sendMessage(op.sessionID, op.text, op.options)
      }
    }),
  )
  const remaining: OfflineOp[] = queue.filter((_, i) => results[i].status === "rejected")
  await writeQueue(remaining)
  syncQueueCount(remaining)

  const sent = before - remaining.length
  if (sent > 0 && remaining.length === 0) {
    useUIStore.getState().showToast({
      message: sent === 1 ? "Queued message sent" : `${sent} queued messages sent`,
      kind: "success",
    })
  }
}

export function setupOfflineDrainOnForeground(): () => void {
  void refreshOfflineQueueCount()

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
