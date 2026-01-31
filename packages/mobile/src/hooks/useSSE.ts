import { useCallback, useEffect, useRef } from "react"
import { useFocusEffect } from "@react-navigation/native"
import { AppState, Platform } from "react-native"
import { sseClient } from "../services/sse-client"
import { useConnectionStore, useEventsStore, useSessionsStore, useSettingsStore } from "../stores"
import type { SSEEvent, SSEConfig } from "../types"

export function useSSE() {
  const connectionStore = useConnectionStore()
  const eventsStore = useEventsStore()
  const sessionsStore = useSessionsStore()
  const settingsStore = useSettingsStore()

  const appState = useRef(AppState.currentState)
  const reconnectOnFocus = useRef(false)

  const handleEvent = useCallback(
    (event: SSEEvent) => {
      eventsStore.addEvent(event)

      const data = event.data as Record<string, unknown> | undefined
      const type = data?.type as string | undefined

      switch (type) {
        case "server.connected":
          connectionStore.setConnected()
          break

        case "server.heartbeat":
          connectionStore.updateLastEvent()
          break

        case "session.created":
        case "session.updated":
          if (data?.properties && typeof data.properties === "object") {
            sessionsStore.upsertSession({
              id: (data.properties as Record<string, unknown>).id as string,
              name: (data.properties as Record<string, unknown>).name as string,
              status: (data.properties as Record<string, unknown>).status as Session["status"],
              createdAt: new Date((data.properties as Record<string, unknown>).createdAt as number),
              lastActivity: new Date(),
              messageCount: 0,
            })
          }
          break

        case "session.status":
          if (data?.properties && typeof data.properties === "object") {
            sessionsStore.updateSessionStatus(
              (data.properties as Record<string, unknown>).id as string,
              (data.properties as Record<string, unknown>).status as Session["status"],
            )
          }
          break

        case "message.updated":
          if (data?.properties && typeof data.properties === "object") {
            const props = data.properties as Record<string, unknown>
            sessionsStore.appendMessage(props.sessionId as string, {
              id: props.id as string,
              sessionId: props.sessionId as string,
              role: props.role as "user" | "assistant" | "system",
              content: props.content as string,
              createdAt: new Date(props.createdAt as number),
            })
          }
          break
      }
    },
    [connectionStore, eventsStore, sessionsStore],
  )

  const handleStatusChange = useCallback(
    (status: ConnectionStore["status"]) => {
      connectionStore.status = status
      if (status === "connected") {
        connectionStore.setConnected()
      } else if (status === "reconnecting") {
        connectionStore.setReconnecting(sseClient.getReconnectAttempt())
      } else if (status === "error" || status === "closed") {
        connectionStore.status = status
      }
    },
    [connectionStore],
  )

  const handleError = useCallback(
    (error: Error) => {
      connectionStore.setError(error.message)
    },
    [connectionStore],
  )

  const connect = useCallback(
    async (config: SSEConfig) => {
      await sseClient.disconnect()

      sseClient.on("event", handleEvent)
      sseClient.on("status", handleStatusChange)
      sseClient.on("error", handleError)

      await sseClient.connect(config)
    },
    [handleEvent, handleStatusChange, handleError],
  )

  const disconnect = useCallback(async () => {
    sseClient.off("event", handleEvent)
    sseClient.off("status", handleStatusChange)
    sseClient.off("error", handleError)

    await sseClient.disconnect()
    connectionStore.disconnect()
  }, [handleEvent, handleStatusChange, handleError, connectionStore])

  const reconnect = useCallback(async () => {
    const url = connectionStore.serverUrl
    const secret = connectionStore.sessionSecret

    if (url && secret) {
      await connect({ url, secret })
    }
  }, [connectionStore.serverUrl, connectionStore.sessionSecret, connect])

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextAppState) => {
      const previous = appState.current
      appState.current = nextAppState

      if (nextAppState === "active" && previous === "background") {
        if (sseClient.getStatus() === "connected") {
          const timeSinceLastEvent = sseClient.getLastEventAt() ? Date.now() - sseClient.getLastEventAt() : Infinity

          if (timeSinceLastEvent > settingsStore.heartbeatInterval * 2) {
            reconnectOnFocus.current = true
          }
        }
      }
    })

    return () => {
      subscription.remove()
    }
  }, [settingsStore.heartbeatInterval])

  useFocusEffect(
    useCallback(() => {
      if (reconnectOnFocus.current) {
        reconnectOnFocus.current = false
        reconnect()
      }

      return () => {}
    }, [reconnect]),
  )

  useEffect(() => {
    return () => {
      if (Platform.OS !== "ios") {
        sseClient.disconnect()
      }
    }
  }, [])

  return {
    status: connectionStore.status,
    serverUrl: connectionStore.serverUrl,
    error: connectionStore.error,
    lastEventAt: connectionStore.lastEventAt,
    reconnectAttempt: connectionStore.reconnectAttempt,
    connect,
    disconnect,
    reconnect,
    isActive: sseClient.isActive(),
  }
}

type ConnectionStore = ReturnType<typeof useConnectionStore>
type Session = ReturnType<typeof useSessionsStore> extends { sessions: infer T } ? T : never
