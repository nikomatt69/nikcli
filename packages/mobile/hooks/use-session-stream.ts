import { useEffect, useRef, useCallback, useState } from "react"
import EventSource from "react-native-sse"
import type { ServerConfig, SessionStreamEvent } from "@/lib/types"

const INITIAL_RETRY_DELAY_MS = 1000
const MAX_RETRY_DELAY_MS = 30000
const MAX_RETRY_ATTEMPTS = 5
const BACKOFF_MULTIPLIER = 2

function extractErrorMessage(error: unknown): string {
  if (typeof error === "string") return error

  if (error && typeof error === "object") {
    const maybeMessage = Reflect.get(error, "message")
    if (typeof maybeMessage === "string" && maybeMessage.trim()) return maybeMessage

    const maybeData = Reflect.get(error, "data")
    if (typeof maybeData === "string" && maybeData.trim()) return maybeData

    if (maybeData && typeof maybeData === "object") {
      const nestedMessage = Reflect.get(maybeData, "message")
      if (typeof nestedMessage === "string" && nestedMessage.trim()) return nestedMessage
    }
  }

  return "Session stream disconnected"
}

export type ConnectionState = "connecting" | "connected" | "reconnecting" | "disconnected"

export function useSessionStream(input: {
  config: ServerConfig | null
  sessionID: string | undefined
  enabled?: boolean
  onEvent(event: SessionStreamEvent): void
  onError?(error: string): void
}) {
  const onEventRef = useRef(input.onEvent)
  const onErrorRef = useRef(input.onError)

  const [connectionState, setConnectionState] = useState<ConnectionState>("disconnected")
  const retryCountRef = useRef(0)
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const esRef = useRef<EventSource | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    onEventRef.current = input.onEvent
  }, [input.onEvent])

  useEffect(() => {
    onErrorRef.current = input.onError
  }, [input.onError])

  const cleanup = useCallback(() => {
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current)
      retryTimeoutRef.current = null
    }
    if (esRef.current) {
      try {
        esRef.current.removeAllListeners?.()
      } finally {
        esRef.current.close()
        esRef.current = null
      }
    }
  }, [])

  const connect = useCallback(() => {
    if (!input.enabled || !input.config || !input.sessionID || !mountedRef.current) {
      return
    }

    cleanup()

    setConnectionState("connecting")
    const url = new URL(
      `/mobile/session/${encodeURIComponent(input.sessionID)}/stream`,
      input.config.url,
    ).toString()

    const headers: Record<string, string> = {
      ...(input.config.token ? { Authorization: `Bearer ${input.config.token}` } : {}),
      ...(input.config.directory ? { "x-nikcli-directory": input.config.directory } : {}),
    }

    const es = new EventSource(url, { headers })
    esRef.current = es

    const reportError = (error: unknown) => {
      if (!mountedRef.current) return
      onErrorRef.current?.(extractErrorMessage(error))
    }

    const onMessage = (message: { data?: string }) => {
      if (!mountedRef.current || !message.data) return

      try {
        onEventRef.current(JSON.parse(message.data) as SessionStreamEvent)
      } catch (error) {
        reportError(error)
      }
    }

    const onError = (_event: Event) => {
      if (!mountedRef.current) return

      es.close()
      esRef.current = null

      if (input.enabled && retryCountRef.current < MAX_RETRY_ATTEMPTS) {
        setConnectionState("reconnecting")
        retryCountRef.current++

        const delay = Math.min(
          INITIAL_RETRY_DELAY_MS * Math.pow(BACKOFF_MULTIPLIER, retryCountRef.current - 1),
          MAX_RETRY_DELAY_MS,
        )

        reportError(
          new Error(
            `Connection lost. Reconnecting in ${Math.round(delay / 1000)}s... (attempt ${retryCountRef.current}/${MAX_RETRY_ATTEMPTS})`,
          ),
        )

        retryTimeoutRef.current = setTimeout(() => {
          if (mountedRef.current) {
            connect()
          }
        }, delay)
      } else {
        setConnectionState("disconnected")
        reportError(new Error("Connection lost. Please refresh the page."))
      }
    }

    es.addEventListener("message", onMessage)
    es.addEventListener("error", onError)

    es.onopen = () => {
      if (mountedRef.current) {
        retryCountRef.current = 0
        setConnectionState("connected")
      }
    }
  }, [input.enabled, input.config, input.sessionID, cleanup])

  useEffect(() => {
    mountedRef.current = true
    retryCountRef.current = 0

    if (input.enabled && input.config && input.sessionID) {
      connect()
    } else {
      setConnectionState("disconnected")
    }

    return () => {
      mountedRef.current = false
      cleanup()
    }
  }, [input.enabled, input.config, input.sessionID, connect, cleanup])

  return {
    connectionState,
    retryCount: retryCountRef.current,
    reconnect: () => {
      retryCountRef.current = 0
      connect()
    },
  }
}
