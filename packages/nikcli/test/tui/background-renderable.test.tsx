import { describe, expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { createMemo, createSignal, Show, type JSX } from "solid-js"
import { createPixelImage } from "@nikcli-ai/tui-image"
import { bufferSize, compose } from "../../src/cli/cmd/tui/feature-plugins/background/pixels"
import type { BackgroundRenderable } from "../../src/cli/cmd/tui/feature-plugins/background/renderable"
import "../../src/cli/cmd/tui/feature-plugins/background/renderable"
import "../../src/cli/cmd/tui/feature-plugins/background/guard"

const BLACK = RGBA.fromInts(0, 0, 0, 255)
const COLUMNS = 4
const ROWS = 2

/** Top half red, bottom half blue — one flat color per half-block. */
function banner(detail: "flat" | "blocks" = "blocks") {
  const image = createPixelImage(COLUMNS, ROWS * 2)
  for (let y = 0; y < ROWS * 2; y++) {
    for (let x = 0; x < COLUMNS; x++) {
      image.data.set(y < ROWS ? [255, 0, 0, 255] : [0, 0, 255, 255], (y * COLUMNS + x) * 4)
    }
  }
  return compose(image, {
    columns: COLUMNS,
    rows: ROWS,
    fit: "cover",
    opacity: 1,
    grayscale: false,
    base: { r: 0, g: 0, b: 0 },
    detail,
  })
}

function ints(color: RGBA) {
  return [color.r, color.g, color.b].map((channel) => Math.round(channel * 255))
}

describe("background renderable", () => {
  test("paints the composed buffer behind the UI and lets text draw over it", async () => {
    const pixels = banner()
    expect(pixels).toHaveLength(bufferSize(COLUMNS, ROWS))

    const { captureSpans, renderer, renderOnce } = await testRender(
      () => (
        <box width={COLUMNS} height={ROWS} backgroundColor={BLACK}>
          <nikcli_background
            position="absolute"
            left={0}
            top={0}
            width={COLUMNS}
            height={ROWS}
            pixels={pixels}
            base={BLACK}
          />
          <text fg={RGBA.fromInts(255, 255, 255, 255)}>hi</text>
        </box>
      ),
      { width: COLUMNS, height: ROWS },
    )
    await renderOnce()

    const cells = captureSpans().lines.map((line) =>
      line.spans.flatMap((span) => [...span.text].map((char) => ({ char, fg: span.fg, bg: span.bg }))),
    )

    // Top row of cells is fully inside the red half, bottom row inside the blue.
    const top = cells[0]!.at(-1)!
    expect(ints(top.fg)).toEqual([255, 0, 0])
    expect(ints(top.bg)).toEqual([255, 0, 0])
    const bottom = cells[1]!.at(-1)!
    expect(ints(bottom.fg)).toEqual([0, 0, 255])
    expect(ints(bottom.bg)).toEqual([0, 0, 255])

    // Text keeps its glyph and color on top of the image.
    const text = cells[0]!.find((cell) => cell.char === "h")
    expect(text).toBeDefined()
    expect(ints(text!.fg)).toEqual([255, 255, 255])
    expect(ints(text!.bg)).toEqual([255, 0, 0])
    renderer.destroy()
  })

  /**
   * The bug these guard: the super-sampler writes a block glyph into every
   * cell, and OpenTUI leaves a cell untouched when the UI draws a space over
   * it — so the glyph survived in the gaps *between* words. The terminal's own
   * text layer then read a line as one unbroken token: dragging a selection
   * copied blocks, and cmd-clicking a path opened the wrong thing, because
   * link detection ran the path together with everything to its left.
   */
  describe("terminal text layer", () => {
    const WIDE = 24
    const LINE = "see /tmp/a.md"

    async function frame(options: { flat?: boolean; guard?: boolean; extra?: () => JSX.Element } = {}) {
      const flat = options.flat ?? false
      // Alternating rows, so the two halves of a cell differ and `blocks`
      // really emits `▀` rather than the `█` a flat color collapses to.
      const image = createPixelImage(WIDE, ROWS * 2)
      for (let y = 0; y < ROWS * 2; y++) {
        for (let x = 0; x < WIDE; x++) {
          image.data.set(y % 2 === 0 ? [120, 60, 40, 255] : [60, 20, 0, 255], (y * WIDE + x) * 4)
        }
      }
      const pixels = compose(image, {
        columns: WIDE,
        rows: ROWS,
        fit: "cover",
        opacity: 1,
        grayscale: false,
        base: { r: 0, g: 0, b: 0 },
        detail: flat ? "flat" : "blocks",
      })
      const [painter, setPainter] = createSignal<BackgroundRenderable>()

      const { captureCharFrame, captureSpans, renderer, renderOnce } = await testRender(
        () => (
          <box width={WIDE} height={ROWS} backgroundColor={BLACK}>
            <nikcli_background
              ref={setPainter}
              position="absolute"
              left={0}
              top={0}
              flat={flat}
              width={WIDE}
              height={ROWS}
              pixels={pixels}
              base={BLACK}
            />
            <text fg={RGBA.fromInts(255, 255, 255, 255)}>{LINE}</text>
            {options.extra?.()}
            <Show when={options.guard ?? true}>
              <nikcli_background_guard
                source={painter()}
                position="absolute"
                left={0}
                top={0}
                width={WIDE}
                height={ROWS}
              />
            </Show>
          </box>
        ),
        { width: WIDE, height: ROWS },
      )
      await renderOnce()
      const lines = captureCharFrame().split("\n")
      const spans = captureSpans().lines
      renderer.destroy()
      return { lines, spans }
    }

    test("without the guard the image stands where the terminal expects whitespace", async () => {
      const { lines } = await frame({ guard: false })
      // Not the glyph the super-sampler picked, but the invariant that broke
      // the terminal: nowhere the screen looks blank is actually blank — not
      // the gap inside the text, not the run trailing it, not an empty row.
      expect(lines[0]!.charAt(LINE.indexOf(" "))).not.toBe(" ")
      expect(lines[0]!).not.toContain(" ")
      expect(lines[1]!).not.toContain(" ")
    })

    test("the guard clears the row's text span and leaves the rest of the image alone", async () => {
      const { lines, spans } = await frame()

      // The line reads exactly as it looks, one cell past its end, so
      // `/tmp/a.md` is a token of its own however the line happens to finish.
      expect(lines[0]!.slice(0, LINE.length + 1)).toBe(`${LINE} `)
      // Past that the wallpaper is untouched, and so is a row with no text.
      expect(lines[0]!.slice(LINE.length + 1)).not.toContain(" ")
      expect(lines[1]!).not.toContain(" ")

      // Cleared cells keep the image: only the glyph went, and with it the
      // half of the cell it was carrying.
      const cleared = spans[0]!.spans
        .flatMap((span) => [...span.text].map((char) => ({ char, bg: span.bg })))
        .at(LINE.indexOf(" "))
      expect(cleared!.char).toBe(" ")
      // The half the glyph was not carrying — the cell's background — is
      // exactly what it was before the guard ran.
      expect(ints(cleared!.bg)).toEqual([120, 60, 40])
    })

    test("the guard leaves blocks the UI itself painted alone", async () => {
      // The logo, meters and borders draw block glyphs of their own inside the
      // very span the guard clears; erasing one would punch a hole in them.
      const extra = () => (
        <text fg={RGBA.fromInts(0, 255, 0, 255)} left={LINE.length + 1} top={0} position="absolute">
          ██
        </text>
      )
      const { lines } = await frame({ extra })
      expect(lines[0]!.slice(LINE.length + 1, LINE.length + 3)).toBe("██")
    })

    test("flat needs no guard: every cell already reads as blank", async () => {
      const { lines, spans } = await frame({ flat: true, guard: false })

      expect(lines[0]).toBe(LINE.padEnd(WIDE, " "))
      expect(lines[1]).toBe(" ".repeat(WIDE))

      // And the image is still there — it lives entirely in the cell's
      // background, which is what "behind the UI" has to mean.
      const cells = spans[1]!.spans.flatMap((span) => [...span.text].map((char) => ({ char, bg: span.bg })))
      expect(cells.every((cell) => cell.char === " ")).toBe(true)
      // The average of the two rows the cell covers.
      expect(ints(cells[0]!.bg)).toEqual([90, 40, 20])
    })
  })

  test("stays behind the UI even when it mounts after it without a JSX z-index", async () => {
    const pixels = banner()
    const [mounted, setMounted] = createSignal(false)

    const { captureSpans, renderer, renderOnce } = await testRender(
      () => (
        <box width={COLUMNS} height={ROWS} backgroundColor={BLACK}>
          <text fg={RGBA.fromInts(255, 255, 255, 255)}>hi</text>
          {/*
            The app mounts the image as a direct child of its root box, which
            is what makes `zIndex: -1` bite: nested one level deeper (under a
            plugin `SlotRenderable`, say) it would only sort against that
            node's own children and keep the order it was mounted in — on top
            of the tabs and the prompt.
          */}
          <Show when={mounted()}>
            <nikcli_background
              position="absolute"
              left={0}
              top={0}
              width={COLUMNS}
              height={ROWS}
              pixels={pixels}
              base={BLACK}
            />
          </Show>
        </box>
      ),
      { width: COLUMNS, height: ROWS },
    )
    await renderOnce()
    // The image decodes asynchronously, so it is added to the root after the
    // UI has already rendered — the way it happens at runtime.
    setMounted(true)
    await renderOnce()

    const cells = captureSpans().lines.map((line) =>
      line.spans.flatMap((span) => [...span.text].map((char) => ({ char, fg: span.fg, bg: span.bg }))),
    )
    const text = cells[0]!.find((cell) => cell.char === "h")
    expect(text).toBeDefined()
    expect(ints(text!.fg)).toEqual([255, 255, 255])
    expect(ints(text!.bg)).toEqual([255, 0, 0])
    renderer.destroy()
  })

  test("stays mounted on its background layer when hidden and shown again", async () => {
    const image = createPixelImage(COLUMNS, ROWS * 2, [255, 0, 0, 255])
    const [enabled, setEnabled] = createSignal(true)
    const [width, setWidth] = createSignal(COLUMNS)
    const [height, setHeight] = createSignal(ROWS)
    const pixels = createMemo(() =>
      compose(image, {
        columns: width(),
        rows: height(),
        fit: "cover",
        opacity: 1,
        grayscale: false,
        base: { r: 0, g: 0, b: 0 },
      }),
    )
    let background: BackgroundRenderable | undefined

    const { captureSpans, renderer, renderOnce } = await testRender(
      () => (
        <box width={COLUMNS} height={ROWS} backgroundColor={BLACK}>
          <nikcli_background
            ref={(value: BackgroundRenderable) => {
              background = value
            }}
            position="absolute"
            left={0}
            top={0}
            paintEnabled={enabled()}
            width={width()}
            height={height()}
            pixels={pixels()}
            base={BLACK}
          />
          <text fg={RGBA.fromInts(255, 255, 255, 255)}>hi</text>
        </box>
      ),
      { width: COLUMNS, height: ROWS },
    )

    await renderOnce()
    const mounted = background
    for (let cycle = 0; cycle < 3; cycle++) {
      setEnabled(false)
      await renderOnce()
      const hiddenText = captureSpans()
        .lines[0]!.spans.flatMap((span) => [...span.text].map((char) => ({ char, bg: span.bg })))
        .find((cell) => cell.char === "h")
      expect(hiddenText).toBeDefined()
      expect(ints(hiddenText!.bg)).toEqual([0, 0, 0])
      setEnabled(true)
      await renderOnce()
    }

    setEnabled(false)
    setWidth(COLUMNS - 1)
    setHeight(ROWS - 1)
    await renderOnce()
    setEnabled(true)
    await renderOnce()

    expect(background).toBe(mounted)
    expect(background?.visible).toBe(true)
    expect(background?.zIndex).toBe(-1)
    expect(background?.frameBuffer.width).toBe(COLUMNS - 1)
    expect(background?.frameBuffer.height).toBe(ROWS - 1)
    const text = captureSpans()
      .lines[0]!.spans.flatMap((span) => [...span.text].map((char) => ({ char, fg: span.fg, bg: span.bg })))
      .find((cell) => cell.char === "h")
    expect(text).toBeDefined()
    expect(ints(text!.fg)).toEqual([255, 255, 255])
    expect(ints(text!.bg)).toEqual([255, 0, 0])
    renderer.destroy()
  })

  test("skips painting when the pixel buffer does not match the terminal size", async () => {
    const { captureSpans, renderer, renderOnce } = await testRender(
      () => (
        <box width={COLUMNS} height={ROWS} backgroundColor={BLACK}>
          <nikcli_background
            position="absolute"
            left={0}
            top={0}
            width={COLUMNS}
            height={ROWS}
            // Sized for a different terminal: must be ignored, not read past.
            pixels={new Uint8Array(bufferSize(COLUMNS + 3, ROWS))}
            base={BLACK}
          />
        </box>
      ),
      { width: COLUMNS, height: ROWS },
    )
    await renderOnce()

    for (const line of captureSpans().lines) {
      for (const span of line.spans) {
        expect(ints(span.bg)).toEqual([0, 0, 0])
      }
    }
    renderer.destroy()
  })
})
