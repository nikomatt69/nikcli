/**
 * Frame — the captured state of a desktop at a point in time.
 *
 * A real desktop has no single authoritative in-memory representation the way
 * a VT grid does for terminals or a DOM does for browsers: "the screen" is
 * whatever the OS would hand to `screencapture`, plus whatever structural
 * metadata we can attach (mode, screen size). A {@link ComputerFrame} bundles
 * the screenshot bytes together with the source info so a single `snapshot()`
 * call is enough for waiting, rendering and evidence capture — mirroring the
 * contract of {@link BrowserFrame} in `@nikcli-ai/browser-control`.
 */

export type Mode = "sandbox" | "host"

export interface ScreenSize {
  readonly width: number
  readonly height: number
}

export interface ComputerFrame {
  /** Which backend produced this frame — useful for downstream rendering. */
  readonly mode: Mode
  /** Logical screen size in pixels. */
  readonly screen: ScreenSize
  /** PNG-encoded screenshot bytes. */
  readonly screenshot: Uint8Array
  /** Wall-clock timestamp of capture (ms since epoch). */
  readonly capturedAt: number
}

export function emptyFrame(mode: Mode, screen: ScreenSize): ComputerFrame {
  return {
    mode,
    screen,
    screenshot: new Uint8Array(0),
    capturedAt: Date.now(),
  }
}
