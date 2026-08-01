import { expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { createPixelImage } from "@nikcli-ai/tui-image"
import { bufferSize, compose } from "../../src/cli/cmd/tui/feature-plugins/background/pixels"
import "../../src/cli/cmd/tui/feature-plugins/background/renderable"

const COLUMNS = 80
const ROWS = 24
const BASE = { r: 15, g: 15, b: 20 }

function ints(color: RGBA) {
  return [color.r, color.g, color.b].map((channel) => Math.round(channel * 255))
}

test("end to end", async () => {
  const image = createPixelImage(32, 16, [200, 100, 0, 255])

  for (const [opacity, expectedBackground] of [
    [1, [200, 100, 0]],
    [0.3, [71, 41, 14]],
  ] as const) {
    const pixels = compose(image, {
      columns: COLUMNS,
      rows: ROWS,
      fit: "cover",
      opacity,
      grayscale: false,
      base: BASE,
    })
    expect(pixels).toHaveLength(bufferSize(COLUMNS, ROWS))

    const { captureSpans, renderer, renderOnce } = await testRender(
      () => (
        <box width={COLUMNS} height={ROWS} backgroundColor={RGBA.fromInts(BASE.r, BASE.g, BASE.b, 255)}>
          <nikcli_background
            position="absolute"
            left={0}
            top={0}
            width={COLUMNS}
            height={ROWS}
            pixels={pixels}
            base={RGBA.fromInts(BASE.r, BASE.g, BASE.b, 255)}
          />
          <box flexGrow={1} alignItems="center" justifyContent="center">
            <text fg={RGBA.fromInts(255, 255, 255, 255)}>Ask anything</text>
          </box>
        </box>
      ),
      { width: COLUMNS, height: ROWS },
    )
    await renderOnce()

    const frame = captureSpans()
    const cells = frame.lines.flatMap((line) =>
      line.spans.flatMap((span) => [...span.text].map((char) => ({ char, fg: span.fg, bg: span.bg }))),
    )
    expect(cells.some((cell) => cell.char === "A" && ints(cell.fg).every((channel) => channel === 255))).toBe(true)
    expect(ints(cells.at(-1)!.bg)).toEqual([...expectedBackground])
    renderer.destroy()
  }
})
