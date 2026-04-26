import type { Message, Part, TextPart } from "@nikcli-ai/sdk/v2"

/** Normalizes a message for one-line list display — matches `/timeline` (DialogTimeline). */
export function formatMessageLineForTimeline(text: string): string {
  return text.replace(/\n/g, " ").trim()
}

/** Last non-synthetic user text line for a session — same rules as DialogTimeline options. */
export function lastUserMessageLine(
  messageBySession: Record<string, Message[] | undefined>,
  partByMessage: Record<string, Part[] | undefined>,
  sessionId: string,
): string | undefined {
  const messages = messageBySession[sessionId] ?? []
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]!
    if (message.role !== "user") continue
    const part = (partByMessage[message.id] ?? []).find(
      (x): x is TextPart => x.type === "text" && !x.synthetic && !x.ignored,
    )
    if (!part) continue
    return formatMessageLineForTimeline(part.text)
  }
  return undefined
}

export function truncateOneLine(text: string, maxChars: number): string {
  if (maxChars < 1) return ""
  if (text.length <= maxChars) return text
  return `${text.slice(0, maxChars - 1)}…`
}
