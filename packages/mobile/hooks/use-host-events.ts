import { useEffect, useRef } from "react"
import EventSource from "react-native-sse"
import { buildMobileHeaders, buildMobileUrl } from "@/lib/client"
import type { HostEvent, ServerConfig } from "@/lib/types"

function extractErrorMessage(error: unknown): string {
  if (typeof error === "string") return error
  if (error && typeof error === "object") {
    const maybeMessage = Reflect.get(error, "message")
    if (typeof maybeMessage === "string" && maybeMessage.trim()) return maybeMessage
  }
  return "Host event stream disconnected"
}

export function useHostEvents(input: {
  config: ServerConfig | null
  enabled?: boolean
  onEvent(event: HostEvent): void
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
    if (input.enabled === false || !input.config) return

    let active = true
    const url = buildMobileUrl(input.config, "/mobile/events")
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
        onEventRef.current(JSON.parse(message.data) as HostEvent)
      } catch (error) {
        reportError(error)
      }
    }

    es.addEventListener("message", onMessage)
    es.addEventListener("error", reportError)

    return () => {
      active = false
      try {
        es.removeAllEventListeners?.()
      } finally {
        es.close()
      }
    }
  }, [input.enabled, input.config?.directory, input.config?.password, input.config?.token, input.config?.url, input.config?.username])
}
