import { useEffect, useRef } from "react"
import EventSource from "react-native-sse"
import type { ServerConfig, SessionStreamEvent } from "@/lib/types"

export function useSessionStream(input: {
  config: ServerConfig | null
  sessionID: string | undefined
  enabled?: boolean
  onEvent(event: SessionStreamEvent): void
  onError?(error: string): void
}) {
  const onEventRef = useRef(input.onEvent)
  const onErrorRef = useRef(input.onError)
  onEventRef.current = input.onEvent
  onErrorRef.current = input.onError

  useEffect(() => {
    if (!input.enabled || !input.config || !input.sessionID) return

    const url = new URL(`/mobile/session/${encodeURIComponent(input.sessionID)}/stream`, input.config.url).toString()
    const es = new EventSource(url, {
      headers: {
        ...(input.config.token ? { Authorization: `Bearer ${input.config.token}` } : {}),
        ...(input.config.directory ? { "x-nikcli-directory": input.config.directory } : {}),
      },
    })

    const onMessage = (message: { data?: string }) => {
      if (!message.data) return
      try {
        onEventRef.current(JSON.parse(message.data) as SessionStreamEvent)
      } catch (error) {
        onErrorRef.current?.(error instanceof Error ? error.message : String(error))
      }
    }

    const onError = (event: any) => {
      onErrorRef.current?.(typeof event?.message === "string" ? event.message : "Session stream disconnected")
    }

    es.addEventListener("message", onMessage)
    es.addEventListener("error", onError)

    return () => {
      es.removeAllEventListeners()
      es.close()
    }
    // Re-connect only when the stream target itself changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input.enabled, input.config?.url, input.config?.token, input.config?.directory, input.sessionID])
}
