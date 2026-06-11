import { describe, expect, test } from "bun:test"
import { renderImage } from "../src/render"
import { Protocol } from "../src/capabilities"
import { checkeredImage, solidImage } from "./_fixtures"
import { createPixelImage } from "../src/pixels"
import type { Decoder } from "../src/decode"

const FIXTURE_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function makeDecoder(): Decoder {
  return async (bytes) => {
    if (bytes[0] === 0x89) return checkeredImage(4, 4)
    return solidImage(2, 2, 255, 0, 0)
  }
}

describe("renderImage", () => {
  test("uses the requested renderer and returns its kind", async () => {
    const result = await renderImage({
      input: FIXTURE_BYTES,
      columns: 10,
      rows: 5,
      decoder: makeDecoder(),
      renderer: "halfblock",
    })
    expect(result.renderer).toBe("halfblock")
    expect(result.protocol).toBeNull()
    expect(typeof result.output).toBe("string")
  })

  test("forces kitty when requested and emits the kitty protocol", async () => {
    const result = await renderImage({
      input: FIXTURE_BYTES,
      columns: 10,
      rows: 5,
      decoder: makeDecoder(),
      renderer: "kitty",
    })
    expect(result.renderer).toBe("kitty")
    expect(result.protocol).toBe(Protocol.KITTY)
    expect(typeof result.output).toBe("string")
  })

  test("forces sixel and returns a Uint8Array", async () => {
    const result = await renderImage({
      input: FIXTURE_BYTES,
      columns: 8,
      rows: 4,
      decoder: makeDecoder(),
      renderer: "sixel",
    })
    expect(result.renderer).toBe("sixel")
    expect(result.protocol).toBe(Protocol.SIXEL)
    expect(result.output).toBeInstanceOf(Uint8Array)
  })

  test("auto-detects sixel from env when renderer is omitted", async () => {
    const result = await renderImage({
      input: FIXTURE_BYTES,
      columns: 8,
      rows: 4,
      decoder: makeDecoder(),
      capabilities: {
        best: Protocol.SIXEL,
        available: [Protocol.SIXEL],
        kitty: false,
        sixel: true,
        iterm2: false,
        terminal: "xterm",
      },
    })
    expect(result.renderer).toBe("sixel")
  })

  test("falls back to halfblock when no native protocol is available", async () => {
    const result = await renderImage({
      input: FIXTURE_BYTES,
      columns: 10,
      rows: 5,
      decoder: makeDecoder(),
      capabilities: {
        best: null,
        available: [],
        kitty: false,
        sixel: false,
        iterm2: false,
        terminal: "dumb",
      },
    })
    expect(result.renderer).toBe("halfblock")
  })

  test("fits a portrait halfblock preview without cropping its height", async () => {
    const portrait: Decoder = async () => checkeredImage(100, 200)
    const result = await renderImage({
      input: FIXTURE_BYTES,
      columns: 60,
      rows: 24,
      decoder: portrait,
      renderer: "halfblock",
    })
    expect(result.columns).toBe(24)
    expect(result.rows).toBe(24)
  })

  test("rejects zero-sized decoders", async () => {
    const empty: Decoder = async () => createPixelImage(0, 0)
    await expect(
      renderImage({
        input: FIXTURE_BYTES,
        columns: 10,
        rows: 5,
        decoder: empty,
        renderer: "halfblock",
      }),
    ).rejects.toThrow()
  })
})
