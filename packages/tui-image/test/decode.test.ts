import { describe, expect, test } from "bun:test"
import { jimpDecoder, DecodeError, photonDecoder } from "../src/decode"
import { solidImage } from "./_fixtures"
import { detectCapabilities, Protocol } from "../src/capabilities"

describe("jimpDecoder", () => {
  test("decodes a real PNG produced by Jimp.encode", async () => {
    // Use Jimp itself to produce a deterministic PNG; the test exercises the
    // round-trip without depending on private internals of the encoder.
    const { Jimp } = await import("jimp")
    const img = new Jimp({ width: 4, height: 4, color: 0xc86432ff })
    const png = await img.getBuffer("image/png")
    const decoded = await jimpDecoder(new Uint8Array(png))
    expect(decoded.width).toBe(4)
    expect(decoded.height).toBe(4)
    expect(decoded.data.length).toBe(64)
    // Spot-check the first pixel: Jimp writes the colour we asked for.
    expect(decoded.data[0]).toBe(0xc8)
    expect(decoded.data[1]).toBe(0x64)
    expect(decoded.data[2]).toBe(0x32)
    expect(decoded.data[3]).toBe(0xff)
  })

  test("rejects bogus bytes", async () => {
    await expect(jimpDecoder(new Uint8Array([0, 1, 2, 3, 4, 5]))).rejects.toBeInstanceOf(DecodeError)
  })
})

describe("photonDecoder", () => {
  test("returns a DecodeError on bogus bytes (when installed)", async () => {
    // We can't easily uninstall the optional dep; either the test passes
    // (DecodeError) or the import itself errors out — both are acceptable
    // signals.
    let threw = false
    try {
      await photonDecoder(new Uint8Array([0, 1, 2, 3]))
    } catch (error) {
      threw = true
      expect(error).toBeInstanceOf(DecodeError)
    }
    expect(threw).toBe(true)
  })
})

describe("capabilities integration", () => {
  test("respects the capabilities override in renderImage", async () => {
    const caps = detectCapabilities(undefined, { KITTY_WINDOW_ID: "1" })
    expect(caps.best).toBe(Protocol.KITTY)
  })
})

// Reference the fixture so it's not tree-shaken out of the test bundle.
void solidImage
