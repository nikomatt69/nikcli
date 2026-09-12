import type { MessageWithParts, Part, TextPart, ToolPart } from "@/lib/types"

/**
 * The transcript as it is laid out, rather than as it is stored.
 *
 * Two things the raw message list cannot express: when a break in time deserves
 * to be shown, and which messages are scaffolding rather than conversation. Both
 * are decided here so the screen only has to render what it is handed.
 */

export type TranscriptRow =
  | { kind: "time"; id: string; label: string; at: number }
  | { kind: "system"; id: string; message: MessageWithParts }
  | { kind: "message"; id: string; message: MessageWithParts }

/** A pause longer than this earns a timestamp between the two messages. */
export const TIME_GAP_MS = 30 * 60 * 1000

function isTextPart(part: Part): part is TextPart {
  return part.type === "text"
}

function isToolPart(part: Part): part is ToolPart {
  return part.type === "tool"
}

/**
 * Context the host injects on the user's behalf — environment, instructions,
 * attached rules. It belongs in the transcript, but not as something the user
 * appears to have said.
 */
export function isScaffoldingMessage(message: MessageWithParts): boolean {
  if (message.info.role !== "user") return false
  const textParts = message.parts.filter(isTextPart)
  if (textParts.length === 0) return false
  if (message.parts.some(isToolPart)) return false
  return textParts.every((part) => part.synthetic === true)
}

export function clockLabel(at: number): string {
  const date = new Date(at)
  const hours = date.getHours()
  const minutes = date.getMinutes().toString().padStart(2, "0")
  return `${hours}:${minutes}`
}

export function buildTranscriptRows(messages: MessageWithParts[], gapMs = TIME_GAP_MS): TranscriptRow[] {
  const rows: TranscriptRow[] = []
  let previousAt: number | undefined

  for (const message of messages) {
    const at = message.info.time.created
    // The first message always gets a timestamp; after that only a real pause does.
    if (previousAt === undefined || at - previousAt >= gapMs) {
      rows.push({ kind: "time", id: `time_${message.info.id}`, label: clockLabel(at), at })
    }
    previousAt = at
    rows.push({
      kind: isScaffoldingMessage(message) ? "system" : "message",
      id: message.info.id,
      message,
    })
  }

  return rows
}

/** Plain text of a scaffolding message, for the expanded disclosure. */
export function scaffoldingText(message: MessageWithParts): string {
  return message.parts
    .filter(isTextPart)
    .map((part) => part.text)
    .join("\n\n")
    .trim()
}
