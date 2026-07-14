import { expect, test } from "bun:test"
import { BoxRenderable, TextRenderable } from "@opentui/core"
import { SimulationPng } from "../src/frontend/png"
import { SimulationRenderer } from "../src/frontend/renderer"

const fixture = new URL("./fixtures/basic.png", import.meta.url)
const visualTest =
  process.platform === "linux" && process.env.CI && process.env.UPDATE_VISUALS !== "1" ? test.skip : test

visualTest("renders a deterministic OpenTUI frame to the visual golden", async () => {
  const renderer = await SimulationRenderer.create({}, undefined, {
    cols: 36,
    rows: 7,
  })
  try {
    const panel = new BoxRenderable(renderer, {
      width: 36,
      height: 7,
      border: true,
      borderStyle: "rounded",
      borderColor: "#4fd6be",
      padding: 1,
    })
    panel.add(
      new TextRenderable(renderer, {
        content: "◇ nikcli simulation\noffline · deterministic · replay",
        fg: "#d6e1e8",
      }),
    )
    renderer.root.add(panel)
    await SimulationRenderer.setupFor(renderer)?.renderOnce()
    const actual = SimulationPng.screenshot(renderer).data

    if (process.env.UPDATE_VISUALS === "1") await Bun.write(fixture, actual)
    expect(await Bun.file(fixture).exists()).toBe(true)
    const expected = new Uint8Array(await Bun.file(fixture).arrayBuffer())
    expect(new Bun.CryptoHasher("sha256").update(actual).digest("hex")).toBe(
      new Bun.CryptoHasher("sha256").update(expected).digest("hex"),
    )
  } finally {
    renderer.destroy()
  }
})
