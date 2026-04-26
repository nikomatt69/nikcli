import { TextAttributes, type RGBA } from "@opentui/core"
import type { SessionStatus } from "@nikcli-ai/sdk/v2"
import { formatMessageLineForTimeline, truncateOneLine } from "@tui/util/timeline-style-text"

type TreeTheme = {
  textMuted: RGBA
  info: RGBA
  warning: RGBA
}

export type SessionStatusDisplayOptions = {
  /** Max characters for the status cell (retry message); ellipsis if longer. */
  maxMessageChars?: number
}

/** Label + fg; `retry` uses the same one-line text rules as `/timeline`. */
export function sessionStatusDisplay(
  status: SessionStatus | undefined,
  t: TreeTheme,
  options?: SessionStatusDisplayOptions,
): { label: string; fg: RGBA; attributes?: number } {
  const max = options?.maxMessageChars ?? 64
  if (status == null) {
    return { label: "idle", fg: t.textMuted, attributes: TextAttributes.DIM }
  }
  switch (status.type) {
    case "idle":
      return { label: "idle", fg: t.textMuted, attributes: TextAttributes.DIM }
    case "busy":
      return { label: "busy", fg: t.info, attributes: TextAttributes.BOLD }
    case "retry": {
      const line = formatMessageLineForTimeline(status.message)
      const base =
        line.length > 0
          ? status.attempt > 1
            ? `(${status.attempt}) ${line}`
            : line
          : status.attempt > 1
            ? `retry #${status.attempt}`
            : "retry"
      return {
        label: truncateOneLine(base, max),
        fg: t.warning,
        attributes: TextAttributes.BOLD,
      }
    }
  }
}

export function formatTreeChangeSummary(s: { files: number; additions: number; deletions: number }): string {
  return `${s.files}f +${s.additions}/-${s.deletions}`
}
