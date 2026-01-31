import { useEffect, useCallback, useState } from "react"
import * as Network from "expo-network"
import { offlineQueue } from "../services/offline-manager"
import type { QueuedOperation } from "../types"

export function useOfflineQueue() {
  const [isConnected, setIsConnected] = useState(false)
  const [queueLength, setQueueLength] = useState(offlineQueue.length)

  useEffect(() => {
    const checkConnection = async () => {
      const state = await Network.getNetworkStateAsync()
      const connected = state.isConnected ?? false
      setIsConnected(connected)

      if (connected && offlineQueue.length > 0) {
        flushQueue()
      }
    }

    checkConnection()

    const interval = setInterval(checkConnection, 5000)

    return () => clearInterval(interval)
  }, [])

  const flushQueue = useCallback(async () => {
    const pending = offlineQueue.peek()
    if (!pending) return

    const operation = offlineQueue.dequeue()
    if (!operation) return

    try {
      await executeOperation(operation)
    } catch (error) {
      console.error("Offline operation failed:", error)

      if (operation.retryCount < 3) {
        offlineQueue.incrementRetry(operation.id)
        offlineQueue.enqueue(operation)
      }
    }

    setQueueLength(offlineQueue.length)

    if (offlineQueue.length > 0) {
      flushQueue()
    }
  }, [])

  const executeOperation = async (_operation: QueuedOperation): Promise<void> => {
    // TODO: Implement actual operation execution
  }

  const enqueue = useCallback(
    (type: QueuedOperation["type"], payload: QueuedOperation["payload"]) => {
      if (isConnected) {
        executeOperation({
          id: `op_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
          type,
          payload,
          timestamp: Date.now(),
          retryCount: 0,
        })
      } else {
        offlineQueue.enqueue({ type, payload })
        setQueueLength(offlineQueue.length)
      }
    },
    [isConnected],
  )

  const clear = useCallback(() => {
    offlineQueue.clear()
    setQueueLength(0)
  }, [])

  return {
    isConnected,
    queueLength,
    enqueue,
    clear,
    flush: flushQueue,
  }
}

export function useNetInfo() {
  const [netInfo, setNetInfo] = useState({
    isConnected: false,
    type: "unknown" as "wifi" | "cellular" | "none" | "unknown",
  })

  useEffect(() => {
    const check = async () => {
      const state = await Network.getNetworkStateAsync()
      setNetInfo({
        isConnected: state.isConnected ?? false,
        type: (state.type?.toLowerCase() as "wifi" | "cellular" | "none" | "unknown") || "unknown",
      })
    }

    check()
    const interval = setInterval(check, 5000)

    return () => clearInterval(interval)
  }, [])

  return netInfo
}
