import { test, expect } from "bun:test"
import { RGBA } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { createPixelImage } from "@nikcli-ai/tui-image"
import { compose } from "../../src/cli/cmd/tui/feature-plugins/background/pixels"
import "../../src/cli/cmd/tui/feature-plugins/background/renderable"

const W = 20
const H = 6
const BG = RGBA.fromInts(10, 10, 10, 255)

function pixels() {
  const img = createPixelImage(4, 4, [200, 40, 40, 255])
  return compose(img, {
    columns: W,
    rows: H,
    fit: "cover",
    opacity: 1,
    grayscale: false,
    base: { r: 10, g: 10, b: 10 },
  })
}

test("app-shaped tree", async () => {
  const { captureSpans, renderOnce } = await testRender(
    () => (
      // mirrors app.tsx: tabs, route content, bottom slot, then the app slot last
      <box width={W} height={H} flexDirection="column" backgroundColor={BG}>
        <box flexShrink={0}>
          <text>tabs</text>
        </box>
        <box flexGrow={1} minHeight={0} width="100%">
          <box flexGrow={1} alignItems="center">
            <text>NIKCLI</text>
          </box>
        </box>
        <box flexShrink={0}>
          <text>bottom</text>
        </box>
        <nikcli_background
          position="absolute"
          left={0}
          top={0}
          zIndex={-1}
          width={W}
          height={H}
          pixels={pixels()}
          base={BG}
        />
      </box>
    ),
    { width: W, height: H },
  )
  await renderOnce()
  for (const [i, line] of captureSpans().lines.entries()) {
    console.log(
      i,
      line.spans
        .map(
          (s) => `${JSON.stringify(s.text)} bg=${[s.bg.r, s.bg.g, s.bg.b].map((x) => Math.round(x * 255)).join(",")}`,
        )
        .join(" | "),
    )
  }
})
