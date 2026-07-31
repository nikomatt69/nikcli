/**
 * `<nikcli_background>` — an OpenTUI renderable that paints an RGBA buffer as
 * a full-screen half-block image.
 *
 * The alternative (a grid of `<text>` cells, the way `bg-pulse.tsx` works) is
 * fine for a few thousand animated cells but not for a photo covering the
 * whole terminal. Here the pixels go straight to the Zig super-sampler, which
 * writes `▀` cells with per-cell foreground/background in one native call.
 *
 * Painting happens into the renderable's own frame buffer and only when the
 * pixels or the size changed; the per-frame cost is the buffer blit that
 * {@link FrameBufferRenderable} already does.
 */
import { FrameBufferRenderable, RGBA, type OptimizedBuffer, type RenderContext } from "@opentui/core"
import { extend } from "@opentui/solid"
import { ptr } from "bun:ffi"
import { bufferSize, bufferStride } from "./pixels"
import { dbg } from "./__debug"

export type BackgroundRenderableOptions = {
  /** Optional: the Solid reconciler assigns size as a prop, after construction. */
  width?: number
  height?: number
  pixels?: Uint8Array
  base?: RGBA
}

const BLACK = RGBA.fromInts(0, 0, 0, 255)

export class BackgroundRenderable extends FrameBufferRenderable {
  private _pixels: Uint8Array | undefined
  private _base: RGBA = BLACK
  private _painted = false

  constructor(ctx: RenderContext, options: BackgroundRenderableOptions) {
    // The frame buffer must exist before layout runs; it is resized to the
    // real size the first time `onResize` fires.
    super(ctx, {
      ...options,
      width: Math.max(1, options.width ?? 1),
      height: Math.max(1, options.height ?? 1),
      respectAlpha: false,
    })
    this.selectable = false
    if (options.base) this._base = options.base
    if (options.pixels) this._pixels = options.pixels
  }

  get pixels(): Uint8Array | undefined {
    return this._pixels
  }

  set pixels(value: Uint8Array | undefined) {
    dbg("set pixels", value?.byteLength ?? 0)
    if (this._pixels === value) return
    this._pixels = value
    this._painted = false
    this.requestRender()
  }

  get base(): RGBA {
    return this._base
  }

  set base(value: RGBA) {
    if (this._base === value) return
    this._base = value
    this._painted = false
    this.requestRender()
  }

  protected override onResize(width: number, height: number) {
    dbg("onResize", width, height)
    super.onResize(width, height)
    this._painted = false
  }

  /** @returns whether the pixel buffer matched the frame buffer and was drawn. */
  private paint() {
    const pixels = this._pixels
    if (!pixels) return false
    const buffer = this.frameBuffer
    // The native super-sampler reads a 2×2 pixel block per cell and does not
    // bounds-check, so an undersized buffer would read past its end. A
    // mismatch here means the terminal resized and the new pixels have not
    // been composed yet — keep the previous frame instead.
    if (pixels.byteLength !== bufferSize(buffer.width, buffer.height)) {
      dbg("paint size mismatch", pixels.byteLength, bufferSize(buffer.width, buffer.height))
      return false
    }
    buffer.clear(this._base)
    buffer.drawSuperSampleBuffer(0, 0, ptr(pixels), pixels.byteLength, "rgba8unorm", bufferStride(buffer.width))
    return true
  }

  protected override renderSelf(buffer: OptimizedBuffer) {
    dbg(
      "renderSelf",
      JSON.stringify({
        painted: this._painted,
        x: this.x,
        y: this.y,
        w: this.width,
        h: this.height,
        fb: [this.frameBuffer.width, this.frameBuffer.height],
        px: this._pixels?.byteLength ?? 0,
        visible: this.visible,
        target: [buffer.width, buffer.height],
      }),
    )
    if (!this._painted) {
      this._painted = this.paint()
      if (!this._painted) return
    }
    super.renderSelf(buffer)
    const probe = (b: OptimizedBuffer, x: number, y: number) => {
      const i = y * b.width + x
      return {
        char: String.fromCodePoint(b.buffers.char[i] ?? 32),
        bg: [b.buffers.bg[i * 4], b.buffers.bg[i * 4 + 1], b.buffers.bg[i * 4 + 2], b.buffers.bg[i * 4 + 3]].map((v) =>
          Math.round((v ?? 0) * 255),
        ),
      }
    }
    dbg(
      "after blit fb(5,5)",
      JSON.stringify(probe(this.frameBuffer, 5, 5)),
      "target(5,5)",
      JSON.stringify(probe(buffer, 5, 5)),
    )
  }
}

extend({ nikcli_background: BackgroundRenderable })
