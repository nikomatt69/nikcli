import type { SSEEvent } from "../types"

interface ParsedSSEEvent extends Partial<SSEEvent> {
  retry?: number
}

export function parseSSEEvent(lines: string[]): ParsedSSEEvent {
  let id: string | undefined
  let event: string | undefined
  let data: string | undefined
  let retry: number | undefined

  for (const line of lines) {
    if (line.startsWith(":")) {
      continue
    }

    const colonIndex = line.indexOf(":")
    const field = colonIndex >= 0 ? line.slice(0, colonIndex) : line
    const value = colonIndex >= 0 ? line.slice(colonIndex + 1).trimStart() : ""

    switch (field) {
      case "id":
        id = value || undefined
        break
      case "event":
        event = value || "message"
        break
      case "data":
        data = value
        break
      case "retry":
        retry = parseInt(value, 10) || undefined
        break
    }
  }

  return { id, event, data, retry }
}

export function serializeEvent(event: SSEEvent): string {
  const lines: string[] = []

  if (event.id) {
    lines.push(`id: ${event.id}`)
  }

  const data = typeof event.data === "string" ? event.data : JSON.stringify(event.data)

  lines.push(`data: ${data}`)

  if (event.event) {
    lines.push(`event: ${event.event}`)
  }

  if (event.timestamp) {
    lines.push(`timestamp: ${event.timestamp}`)
  }

  return lines.join("\n")
}

export function splitSSEStream(buffer: string): string[] {
  const events: string[] = []
  let currentEvent = ""

  for (const line of buffer.split("\n")) {
    if (line === "") {
      if (currentEvent) {
        events.push(currentEvent)
        currentEvent = ""
      }
    } else {
      currentEvent += line + "\n"
    }
  }

  if (currentEvent) {
    events.push(currentEvent)
  }

  return events
}

export function extractEventType(eventData: unknown): string {
  if (eventData && typeof eventData === "object" && "type" in eventData) {
    return String((eventData as Record<string, unknown>).type)
  }
  return "unknown"
}

export function extractEventProperties(eventData: unknown): Record<string, unknown> {
  if (eventData && typeof eventData === "object" && "properties" in eventData) {
    return (eventData as Record<string, unknown>).properties as Record<string, unknown>
  }
  return {}
}
