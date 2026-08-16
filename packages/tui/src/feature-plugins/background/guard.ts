/**
 * `<nikcli_background_guard>` — keeps the terminal's own text layer readable
 * while the wallpaper stays at full detail.
 *
 * The image is painted as half-blocks, which means a real glyph in every cell
 * the UI does not cover. OpenTUI leaves a cell untouched when text draws a
 * space over it, so those glyphs survive *inside* the UI too: the gaps between
 * words, the padding around a line. The terminal — which knows nothing about
 * layers — then reads a line like `see /tmp/a.md` as one unbroken token. That
 * is what breaks selection (dragging copies blocks instead of text) and
 * cmd/ctrl-click (link detection runs the path together with everything to its
 * left, so it opens the wrong target, or nothing).
 *
 * The fix is not to paint a coarser image, it is to stop painting *where the
 * terminal needs whitespace*: on every row that carries UI text, the cells
 * still holding the untouched background between its ends are set back to a
 * space. They keep their background color, so the image is unchanged except
 * for the top half of those few cells; everywhere the UI does not reach — most
 * of the screen — the half-blocks are exactly what they were.
 *
 * This runs after the whole frame is composed, which is what the very high
 * `zIndex` buys: siblings render in `zIndex` order, so the guard sees the UI's
 * output rather than racing it.
 */
import { Renderable, type OptimizedBuffer, type RenderContext } from "@opentui/core"
import { extend } from "@opentui/solid"
import type { BackgroundRenderable } from "./renderable"

export type BackgroundGuardOptions = {
  width?: number
  height?: number
  source?: BackgroundRenderable
}

/** `" "` — what an untouched cell becomes. */
const SPACE = 32

/**
 * How far past the outermost UI cell the clearing reaches. One cell, so a
 * token that ends a line still ends against whitespace rather than a block.
 */
const MARGIN = 1

export class BackgroundGuardRenderable extends Renderable {
  private _source: BackgroundRenderable | undefined

  constructor(ctx: RenderContext, options: BackgroundGuardOptions) {
    super(ctx, { ...options, zIndex: Number.MAX_SAFE_INTEGER })
    this.selectable = false
    if (options.source) this._source = options.source
  }

  get source(): BackgroundRenderable | undefined {
    return this._source
  }

  set source(value: BackgroundRenderable | undefined) {
    this._source = value
    this.requestRender()
  }

  override render(buffer: OptimizedBuffer) {
    // Deliberately not `super.render`. The base implementation ends by
    // registering the renderable in the hit grid, and this one covers the
    // whole screen on the topmost layer: it would take every click on its way
    // to the tabs, the prompt, anything. The guard reads the frame and edits
    // it — it is not a surface anyone can point at.
    this.renderSelf(buffer)
    this.markClean()
  }

  protected override renderSelf(buffer: OptimizedBuffer) {
    const source = this._source
    // `flat` already writes spaces everywhere, so there is nothing to clear;
    // and with nothing painted this frame the comparison below would be
    // against a stale buffer.
    if (!source || !source.painting || source.flat) return
    const painted = source.frameBuffer
    if (painted.width !== buffer.width || painted.height !== buffer.height) return

    const width = buffer.width
    const composed = buffer.buffers
    const mine = painted.buffers

    for (let y = 0; y < buffer.height; y++) {
      const row = y * width
      let first = -1
      let last = -1

      // Where the row's UI content starts and ends. Comparing the glyph alone
      // is enough to place those ends — a UI cell that happens to draw the
      // same glyph the image did just moves an end by a column — and it keeps
      // this pass, the one that runs over every cell of every frame, down to a
      // single integer compare.
      for (let x = 0; x < width; x++) {
        if (composed.char[row + x] === mine.char[row + x]) continue
        if (first < 0) first = x
        last = x
      }
      if (first < 0) continue

      const from = Math.max(0, first - MARGIN)
      const to = Math.min(width - 1, last + MARGIN)
      for (let x = from; x <= to; x++) {
        const cell = row + x
        // Only cells still bit-identical to what the background painted. The
        // colors have to match too, not just the glyph: the UI paints blocks
        // of its own — the logo, meters, borders — and clearing one of those
        // would punch a hole in it.
        if (composed.char[cell] === mine.char[cell] && sameColor(composed, mine, cell)) {
          composed.char[cell] = SPACE
        }
      }
    }
  }
}

type Buffers = OptimizedBuffer["buffers"]

/** Whether both buffers hold the same foreground and background at `cell`. */
function sameColor(composed: Buffers, mine: Buffers, cell: number) {
  const channel = cell * 4
  for (let offset = 0; offset < 4; offset++) {
    if (composed.fg[channel + offset] !== mine.fg[channel + offset]) return false
    if (composed.bg[channel + offset] !== mine.bg[channel + offset]) return false
  }
  return true
}

extend({ nikcli_background_guard: BackgroundGuardRenderable })
