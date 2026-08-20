/**
 * Screencast — a live PNG stream of a page.
 *
 * {@link BrowserSession.snapshot} is a *pull*. A live view wants a *push*:
 * frames when the pixels change, coalesced to the latest one. Bun.WebView
 * (WebKit on macOS) has no screencast CDP, so we poll `screenshot()` through
 * the session mutex and keep a one-slot mailbox so a slow consumer drops
 * stale frames instead of stalling the producer.
 */
import type { Viewport } from "./frame"

export interface ScreencastOptions {
  readonly maxWidth?: number
  readonly maxHeight?: number
  readonly everyNthFrame?: number
  readonly maxFps?: number
}

export interface ScreencastFrame {
  readonly seq: number
  readonly png: Uint8Array
  readonly width: number
  readonly height: number
  readonly deviceWidth: number
  readonly deviceHeight: number
  readonly scrollOffsetX: number
  readonly scrollOffsetY: number
  readonly pageScaleFactor: number
  readonly timestamp: number
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const
const IHDR_WIDTH_OFFSET = 16

export function pngDimensions(png: Uint8Array): { width: number; height: number } | null {
  if (png.byteLength < IHDR_WIDTH_OFFSET + 8) return null
  for (let i = 0; i < PNG_SIGNATURE.length; i++) if (png[i] !== PNG_SIGNATURE[i]) return null
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength)
  return { width: view.getUint32(IHDR_WIDTH_OFFSET), height: view.getUint32(IHDR_WIDTH_OFFSET + 4) }
}

export type ScreencastCapture = () => Promise<Uint8Array>

export class Screencast {
  private pending: ScreencastFrame | null = null
  private wake: (() => void) | null = null
  private seq = 0
  private lastDelivered = 0
  private skipped = 0
  private stopped = false
  private failure: Error | null = null
  private readonly minFrameIntervalMs: number
  private readonly everyNthFrame: number
  private loopPromise: Promise<void>

  private constructor(
    private readonly capture: ScreencastCapture,
    private readonly viewport: Viewport,
    options: ScreencastOptions,
  ) {
    const fps = options.maxFps && options.maxFps > 0 ? options.maxFps : 8
    this.minFrameIntervalMs = 1000 / fps
    this.everyNthFrame = options.everyNthFrame && options.everyNthFrame > 0 ? options.everyNthFrame : 1
    this.loopPromise = this.loop()
  }

  static start(capture: ScreencastCapture, viewport: Viewport, options: ScreencastOptions = {}): Screencast {
    return new Screencast(capture, viewport, options)
  }

  private async loop(): Promise<void> {
    while (!this.stopped) {
      const started = Date.now()
      try {
        const png = await this.capture()
        if (this.stopped) return
        this.skipped += 1
        if (this.skipped % this.everyNthFrame !== 0) {
          await delay(this.minFrameIntervalMs)
          continue
        }
        const size = pngDimensions(png)
        if (size) {
          this.lastDelivered = Date.now()
          this.seq += 1
          this.pending = {
            seq: this.seq,
            png,
            width: size.width,
            height: size.height,
            deviceWidth: this.viewport.width,
            deviceHeight: this.viewport.height,
            scrollOffsetX: 0,
            scrollOffsetY: 0,
            pageScaleFactor: 1,
            timestamp: this.lastDelivered / 1000,
          }
          this.signal()
        }
      } catch (error) {
        if (this.stopped) return
        this.failure = error instanceof Error ? error : new Error(String(error))
        this.signal()
        return
      }
      const wait = this.minFrameIntervalMs - (Date.now() - started)
      if (wait > 0) await delay(wait)
    }
  }

  private signal(): void {
    const wake = this.wake
    this.wake = null
    wake?.()
  }

  async *frames(): AsyncGenerator<ScreencastFrame> {
    while (!this.stopped) {
      const frame = this.pending
      if (frame) {
        this.pending = null
        yield frame
        continue
      }
      if (this.failure) throw this.failure
      await new Promise<void>((resolve) => {
        this.wake = resolve
      })
    }
    if (this.failure) throw this.failure
  }

  async stop(): Promise<void> {
    if (this.stopped) return
    this.stopped = true
    this.pending = null
    this.signal()
    await this.loopPromise.catch(() => {})
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
