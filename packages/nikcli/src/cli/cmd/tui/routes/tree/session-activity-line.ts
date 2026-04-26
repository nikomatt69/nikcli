import { TextAttributes, type RGBA } from "@opentui/core"
import { lastUserMessageLine, truncateOneLine } from "@tui/util/timeline-style-text"
import { sessionStatusDisplay, type SessionStatusDisplayOptions } from "./session-status"
import type { useSync } from "@tui/context/sync"

type SyncData = ReturnType<typeof useSync>["data"]

export type SessionTreeActivityTheme = {
  text: RGBA
  textMuted: RGBA
  info: RGBA
  warning: RGBA
}

/** Prefer last user message (same as /timeline); otherwise session status (idle / busy / retry). */
export function sessionTreeActivityDisplay(
  data: SyncData,
  sessionId: string,
  theme: SessionTreeActivityTheme,
  options?: SessionStatusDisplayOptions,
): { label: string; fg: RGBA; attributes?: number } {
  const max = options?.maxMessageChars ?? 64
  const last = lastUserMessageLine(data.message, data.part, sessionId)
  if (last) {
    return {
      label: truncateOneLine(last, max),
      fg: theme.text,
      attributes: TextAttributes.DIM,
    }
  }
  return sessionStatusDisplay(
    data.session_status[sessionId],
    { textMuted: theme.textMuted, info: theme.info, warning: theme.warning },
    options,
  )
}
