/**
 * Screencast — a live PNG stream of a page, straight from Chromium.
 *
 * {@link BrowserSession.snapshot} is a *pull*: ask the page for a screenshot,
 * wait for it, get one image. That is the right shape for an agent inspecting a
 * page, and completely the wrong shape for a live view — polling `screenshot()`
 * in a loop burns a full capture per frame whether or not anything changed, and
 * the round-trip latency is the frame budget.
 *
 * CDP's `Page.startScreencast` is the *push* counterpart: Chromium emits a
 * frame when the page actually changes, and stops when it doesn't. Playwright
 * exposes raw CDP for Chromium through `BrowserContext.newCDPSession`, so this
 * is a thin adapter rather than a second browser driver.
 *
 * Two rules the protocol imposes, both load-bearing:
 *
 *  1. **Every frame must be acked.** Chromium waits for
 *     `Page.screencastFrameAck` before sending the next one. Ack immediately on
 *     arrival, never after handing the frame downstream — a slow consumer would
 *     otherwise stall the producer instead of dropping frames.
 *  2. **The consumer is always behind.** The mailbox below holds exactly one
 *     frame: a newer frame overwrites an older unconsumed one. A live view
 *     wants the current pixels, never a backlog of stale ones.
 */
import type { BrowserContext, CDPSession, Page } from "playwright"

export interface ScreencastOptions {
  /** Cap the captured image width in pixels. Chromium scales to fit. */
  readonly maxWidth?: number
  /** Cap the captured image height in pixels. */
  readonly maxHeight?: number
  /** Ask Chromium to emit only every Nth frame. */
  readonly everyNthFrame?: number
  /** Upper bound on frames delivered downstream; frames arriving sooner are coalesced. */
  readonly maxFps?: number
}

export interface ScreencastFrame {
  /** Monotonic counter, starting at 1. Gaps mean frames were dropped. */
  readonly seq: number
  /** PNG bytes exactly as Chromium encoded them — never decoded or re-encoded here. */
  readonly png: Uint8Array
  /** Pixel dimensions read from the PNG header. */
  readonly width: number
  readonly height: number
  /** Page-space metadata, needed to map a click back onto the document. */
  readonly deviceWidth: number
  readonly deviceHeight: number
  readonly scrollOffsetX: number
  readonly scrollOffsetY: number
  readonly pageScaleFactor: number
  /** Chromium's frame timestamp, in seconds since the epoch. */
  readonly timestamp: number
}

interface ScreencastFrameEvent {
  readonly data: string
  readonly sessionId: number
  readonly metadata?: {
    readonly deviceWidth?: number
    readonly deviceHeight?: number
    readonly scrollOffsetX?: number
    readonly scrollOffsetY?: number
    readonly pageScaleFactor?: number
    readonly timestamp?: number
  }
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const
const IHDR_WIDTH_OFFSET = 16

/**
 * Read pixel dimensions out of a PNG's IHDR chunk — always the first chunk, at
 * a fixed offset. Cheaper than decoding, and the placement geometry needs the
 * real transmitted size rather than the requested one (Chromium rounds).
 */
export function pngDimensions(png: Uint8Array): { width: number; height: number } | null {
  if (png.byteLength < IHDR_WIDTH_OFFSET + 8) return null
  for (let i = 0; i < PNG_SIGNATURE.length; i++) if (png[i] !== PNG_SIGNATURE[i]) return null
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength)
  return { width: view.getUint32(IHDR_WIDTH_OFFSET), height: view.getUint32(IHDR_WIDTH_OFFSET + 4) }
}

export class Screencast {
  private readonly cdp: CDPSession
  private readonly minFrameIntervalMs: number
  private pending: ScreencastFrame | null = null
  private wake: (() => void) | null = null
  private seq = 0
  private lastDelivered = 0
  private stopped = false
  private failure: Error | null = null

  private constructor(cdp: CDPSession, options: ScreencastOptions) {
    this.cdp = cdp
    const fps = options.maxFps && options.maxFps > 0 ? options.maxFps : 0
    this.minFrameIntervalMs = fps > 0 ? 1000 / fps : 0
  }

  static async start(context: BrowserContext, page: Page, options: ScreencastOptions = {}): Promise<Screencast> {
    const cdp = await context.newCDPSession(page)
    const screencast = new Screencast(cdp, options)
    cdp.on("Page.screencastFrame", (event: unknown) => screencast.onFrame(event as ScreencastFrameEvent))
    await cdp.send("Page.startScreencast", {
      format: "png",
      ...(options.maxWidth === undefined ? {} : { maxWidth: options.maxWidth }),
      ...(options.maxHeight === undefined ? {} : { maxHeight: options.maxHeight }),
      ...(options.everyNthFrame === undefined ? {} : { everyNthFrame: options.everyNthFrame }),
    })
    return screencast
  }

  private onFrame(event: ScreencastFrameEvent): void {
    // Ack first, unconditionally: the producer is waiting on it, and a frame we
    // decide to drop still has to be acked or the stream simply stops.
    this.cdp.send("Page.screencastFrameAck", { sessionId: event.sessionId }).catch(() => {})
    if (this.stopped) return

    const now = Date.now()
    if (this.minFrameIntervalMs > 0 && now - this.lastDelivered < this.minFrameIntervalMs) return

    let png: Uint8Array
    try {
      png = Uint8Array.fromBase64(event.data)
    } catch {
      return
    }
    const size = pngDimensions(png)
    if (!size) return

    this.lastDelivered = now
    this.seq += 1
    const metadata = event.metadata ?? {}
    // Single-slot mailbox: an unconsumed frame is replaced, not queued.
    this.pending = {
      seq: this.seq,
      png,
      width: size.width,
      height: size.height,
      deviceWidth: metadata.deviceWidth ?? size.width,
      deviceHeight: metadata.deviceHeight ?? size.height,
      scrollOffsetX: metadata.scrollOffsetX ?? 0,
      scrollOffsetY: metadata.scrollOffsetY ?? 0,
      pageScaleFactor: metadata.pageScaleFactor ?? 1,
      timestamp: metadata.timestamp ?? now / 1000,
    }
    this.signal()
  }

  private signal(): void {
    const wake = this.wake
    this.wake = null
    wake?.()
  }

  /**
   * Yields the most recent frame, waiting when none is pending. Ends when
   * {@link stop} is called or the page goes away.
   */
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
    await this.cdp.send("Page.stopScreencast").catch(() => {})
    await this.cdp.detach().catch(() => {})
  }
}
