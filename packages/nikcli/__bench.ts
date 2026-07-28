import { pickDecoder } from "@nikcli-ai/tui-image"
import { prepare } from "/Volumes/SSD/Projects/nikcli/packages/nikcli/src/cli/cmd/tui/feature-plugins/background/pixels"

const bytes = new Uint8Array(await Bun.file("/Users/nikoemme-os/Desktop/HOPVd8YXYAAPPGg.jpeg").arrayBuffer())
for (const preferWasm of [false, true]) {
  try {
    let t = performance.now()
    const decoder = await pickDecoder({ preferWasm })
    const pick = performance.now() - t
    t = performance.now()
    const image = await decoder(bytes)
    const decode = performance.now() - t
    t = performance.now()
    const small = prepare(image)
    const prep = performance.now() - t
    console.log(`preferWasm=${preferWasm} pick=${Math.round(pick)}ms decode=${Math.round(decode)}ms prepare=${Math.round(prep)}ms -> ${small.width}x${small.height} (src ${image.width}x${image.height})`)
  } catch (e) {
    console.log(`preferWasm=${preferWasm} failed`, String(e).slice(0, 120))
  }
}
