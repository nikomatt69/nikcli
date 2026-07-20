/** PNG rendering — a browser screenshot is already a PNG, so this is a typed passthrough. */
import type { BrowserFrame } from "../frame"

export function renderPng(frame: BrowserFrame): Uint8Array {
  return frame.screenshot
}
