import { describe, expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { createSignal, Show } from "solid-js"
import { createPixelImage } from "@nikcli-ai/tui-image"
import { bufferSize, compose } from "../../src/cli/cmd/tui/feature-plugins/background/pixels"
import type { BackgroundRenderable } from "../../src/cli/cmd/tui/feature-plugins/background/renderable"
import "../../src/cli/cmd/tui/feature-plugins/background/renderable"

const BLACK = RGBA.fromInts(0, 0, 0, 255)
const COLUMNS = 4
const ROWS = 2

/** Top half red, bottom half blue — one flat color per half-block. */
function banner() {
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
  })
}

function ints(color: RGBA) {
  return [color.r, color.g, color.b].map((channel) => Math.round(channel * 255))
}

describe("background renderable", () => {
  test("paints the composed buffer behind the UI and lets text draw over it", async () => {
    const pixels = banner()
    expect(pixels).toHaveLength(bufferSize(COLUMNS, ROWS))

    const { captureSpans, renderOnce } = await testRender(
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
  })

  test("stays behind the UI even when it mounts after it without a JSX z-index", async () => {
    const pixels = banner()
    const [mounted, setMounted] = createSignal(false)

    const { captureSpans, renderOnce } = await testRender(
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
  })

  test("stays mounted on its background layer when hidden and shown again", async () => {
    const pixels = banner()
    const [visible, setVisible] = createSignal(true)
    let background: BackgroundRenderable | undefined

    const { captureSpans, renderOnce } = await testRender(
      () => (
        <box width={COLUMNS} height={ROWS} backgroundColor={BLACK}>
          <nikcli_background
            ref={(value: BackgroundRenderable) => {
              background = value
            }}
            position="absolute"
            left={0}
            top={0}
            visible={visible()}
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
    const mounted = background
    setVisible(false)
    await renderOnce()
    setVisible(true)
    await renderOnce()

    expect(background).toBe(mounted)
    const text = captureSpans()
      .lines[0]!.spans.flatMap((span) => [...span.text].map((char) => ({ char, fg: span.fg, bg: span.bg })))
      .find((cell) => cell.char === "h")
    expect(text).toBeDefined()
    expect(ints(text!.fg)).toEqual([255, 255, 255])
    expect(ints(text!.bg)).toEqual([255, 0, 0])
  })

  test("skips painting when the pixel buffer does not match the terminal size", async () => {
    const { captureSpans, renderOnce } = await testRender(
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
  })
})
