/** JSON rendering of a {@link BrowserFrame}, screenshot bytes base64-encoded for portability. */
import type { BrowserFrame } from "../frame"

export interface JSONFrame {
  readonly url: string
  readonly title: string
  readonly viewport: { readonly width: number; readonly height: number }
  readonly screenshotBase64: string
  readonly text: string
  readonly console: BrowserFrame["console"]
}

export function toJSONFrame(frame: BrowserFrame): JSONFrame {
  return {
    url: frame.url,
    title: frame.title,
    viewport: frame.viewport,
    screenshotBase64: Buffer.from(frame.screenshot).toString("base64"),
    text: frame.text,
    console: frame.console,
  }
}

export function renderJSON(frame: BrowserFrame): string {
  return JSON.stringify(toJSONFrame(frame), null, 2)
}
