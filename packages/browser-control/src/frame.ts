/**
 * Frame — the captured state of a page at a point in time.
 *
 * Unlike terminal-control's {@link Frame} (a synchronous VT100 cell grid), a
 * browser page has no single authoritative in-memory representation: capturing
 * it means asking the page for a screenshot and an accessibility snapshot. A
 * {@link BrowserFrame} bundles both together with the console log so a single
 * `snapshot()` call is enough for waiting, rendering and evidence capture.
 */

export interface Viewport {
  readonly width: number
  readonly height: number
}

export interface ConsoleEntry {
  readonly time: number
  readonly type: string
  readonly text: string
}

export interface BrowserFrame {
  readonly url: string
  readonly title: string
  readonly viewport: Viewport
  /** PNG-encoded screenshot bytes. */
  readonly screenshot: Uint8Array
  /** Indented text rendering of the page's accessibility tree. */
  readonly text: string
  /** Console messages observed since the session started, capped to the last 200. */
  readonly console: ReadonlyArray<ConsoleEntry>
}

export function emptyFrame(viewport: Viewport): BrowserFrame {
  return {
    url: "about:blank",
    title: "",
    viewport,
    screenshot: new Uint8Array(0),
    text: "",
    console: [],
  }
}
