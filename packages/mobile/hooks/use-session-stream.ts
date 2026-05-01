import { useEffect, useRef } from "react"
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

  useEffect(() => {
    onEventRef.current = input.onEvent
  }, [input.onEvent])

  useEffect(() => {
    onErrorRef.current = input.onError
  }, [input.onError])

  useEffect(() => {
    if (!input.enabled || !input.config || !input.sessionID) return

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
    input.config?.directory,
    input.config?.password,
    input.config?.token,
    input.config?.url,
    input.config?.username,
    input.sessionID,
  ])
}
