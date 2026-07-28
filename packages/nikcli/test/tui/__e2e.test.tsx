import { test } from "bun:test"
import { RGBA } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { Jimp } from "jimp"
import { compose } from "../../src/cli/cmd/tui/feature-plugins/background/pixels"
import { loadImage, resolveSource } from "../../src/cli/cmd/tui/feature-plugins/background/source"
import "../../src/cli/cmd/tui/feature-plugins/background/renderable"

const COLUMNS = 300
const ROWS = 90
const OUT = "/tmp/claude-501/-Volumes-SSD-Projects-nikcli/19050acc-19e7-481d-b88a-996fa5a61cf7/scratchpad"

test("end to end", async () => {
  const image = await loadImage(await resolveSource("/Users/nikoemme-os/Desktop/HOPVd8YXYAAPPGg.jpeg"))
  console.log("decoded+prepared", image.width, "x", image.height)

  for (const [name, opacity] of [["full", 1], ["dim", 0.3]] as const) {
    const started = performance.now()
    const pixels = compose(image, {
      columns: COLUMNS,
      rows: ROWS,
      fit: "cover",
      opacity,
      grayscale: false,
      base: { r: 15, g: 15, b: 20 },
    })
    console.log(name, "compose ms", Math.round(performance.now() - started))

    const { captureSpans, renderOnce } = await testRender(
      () => (
        <box width={COLUMNS} height={ROWS} backgroundColor={RGBA.fromInts(15, 15, 20, 255)}>
          <nikcli_background position="absolute" left={0} top={0} zIndex={-1} width={COLUMNS} height={ROWS} pixels={pixels} base={RGBA.fromInts(15,15,20,255)} />
          <box flexGrow={1} alignItems="center" justifyContent="center">
            <text fg={RGBA.fromInts(255,255,255,255)}>ask anything... "what is the tech stack of this project?"</text>
          </box>
        </box>
      ),
      { width: COLUMNS, height: ROWS },
    )
    await renderOnce()

    // Rebuild what the terminal shows: each cell is two stacked pixels (fg over bg).
    const out = new Jimp({ width: COLUMNS, height: ROWS * 2, color: 0x000000ff })
    captureSpans().lines.forEach((line, row) => {
      let col = 0
      for (const span of line.spans) {
        for (const char of span.text) {
          const upper = char === "▀" || char === "█" ? span.fg : char === "▄" ? span.bg : span.fg
          const lower = char === "▄" || char === "█" ? span.fg : span.bg
          const put = (y: number, c: { r: number; g: number; b: number }) => {
            if (col >= COLUMNS) return
            out.setPixelColor(
              (((Math.round(c.r * 255) << 24) | (Math.round(c.g * 255) << 16) | (Math.round(c.b * 255) << 8) | 0xff) >>> 0),
              col,
              y,
            )
          }
          put(row * 2, upper)
          put(row * 2 + 1, lower)
          col++
        }
      }
    })
    await out.write(`${OUT}/bg-${name}.png` as `${string}.png`)
    console.log("wrote", `${OUT}/bg-${name}.png`)
  }
})
