import { useEffect, useRef, useState } from "react"
import { AppState } from "react-native"
import EventSource from "react-native-sse"
import { buildMobileHeaders, buildMobileUrl } from "@/lib/client"
import type { ServerConfig, SessionStreamEvent } from "@/lib/types"

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

export function useSessionStream(input: {
  config: ServerConfig | null
  sessionID: string | undefined
  enabled?: boolean
  onEvent(event: SessionStreamEvent): void
  onError?(error: string): void
}) {
  const onEventRef = useRef(input.onEvent)
  const onErrorRef = useRef(input.onError)
  const [isForeground, setIsForeground] = useState(AppState.currentState === "active")

  useEffect(() => {
    onEventRef.current = input.onEvent
  }, [input.onEvent])

  useEffect(() => {
    onErrorRef.current = input.onError
  }, [input.onError])

  // react-native-sse auto-reconnects on error/close by default, so leaving
  // the EventSource open while the app is backgrounded keeps the radio and
  // CPU awake indefinitely. Track foreground state and gate the connection
  // on it below so the stream tears down on background and reopens on
  // return to foreground.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      setIsForeground(state === "active")
    })
    return () => subscription.remove()
  }, [])

  // react-native-sse's EventSource does not expose a per-listener
  // removeEventListener; removeAllEventListeners() drops every
  // subscription registered below, and es.close() shuts the stream
  // down. The linter doesn't recognise this two-step teardown.
  // oxlint-disable-next-line react-doctor/effect-needs-cleanup
  useEffect(() => {
    if (!input.enabled || !isForeground || !input.config || !input.sessionID) return

    let active = true
    const url = buildMobileUrl(input.config, `/mobile/session/${encodeURIComponent(input.sessionID)}/stream`)
    const es = new EventSource(url, {
      headers: buildMobileHeaders(input.config),
    })

    const reportError = (error: unknown) => {
      if (!active) return
      onErrorRef.current?.(extractErrorMessage(error))
    }

    const onMessage = (message: { data?: string }) => {
      if (!active || !message.data) return

      try {
        onEventRef.current(JSON.parse(message.data) as SessionStreamEvent)
      } catch (error) {
        reportError(error)
      }
    }

    const onError = (event: unknown) => {
      reportError(event)
    }

    es.addEventListener("message", onMessage)
    es.addEventListener("error", onError)

    return () => {
      active = false

      try {
        es.removeAllEventListeners?.()
      } finally {
        es.close()
      }
    }
  }, [
    input.enabled,
    isForeground,
    input.config?.directory,
    input.config?.password,
    input.config?.token,
    input.config?.url,
    input.config?.username,
    input.sessionID,
  ])
}
