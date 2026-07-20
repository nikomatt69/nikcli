/** Text rendering — the accessibility-tree analog of terminal-control's cell-grid text render. */
import type { BrowserFrame } from "../frame"

/** The frame's precomputed text rendering: `page.ariaSnapshot()`'s YAML-ish accessibility tree. */
export function renderText(frame: BrowserFrame): string {
  return frame.text
}
