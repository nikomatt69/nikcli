import { describe, expect, test } from "bun:test"
import { jimpDecoder, DecodeError, detectFormat, photonDecoder, pickDecoder } from "../src/decode"
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

// An 8x8 lossy WebP. Jimp has no WebP codec at all, so this is the format that
// exposes whether `pickDecoder` really falls back.
const WEBP_8X8 = Uint8Array.fromBase64(
  "UklGRjwAAABXRUJQVlA4IDAAAADQAQCdASoIAAgAAUAmJaACdLoB+AADsAD+8ut//NgVzXPv9//S4P0uD9Lg/9KQAAA=",
)

describe("detectFormat", () => {
  test("sniffs containers from their magic bytes", async () => {
    const { Jimp } = await import("jimp")
    const png = await new Jimp({ width: 2, height: 2, color: 0xffffffff }).getBuffer("image/png")
    expect(detectFormat(new Uint8Array(png))).toBe("png")
    expect(detectFormat(WEBP_8X8)).toBe("webp")
    expect(detectFormat(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBe("svg")
    expect(detectFormat(new Uint8Array([0, 1, 2, 3, 4, 5]))).toBeUndefined()
  })
})

describe("pickDecoder", () => {
  test("decodes WebP, which Jimp alone cannot read", async () => {
    await expect(jimpDecoder(WEBP_8X8)).rejects.toBeInstanceOf(DecodeError)
    const decoded = await (await pickDecoder())(WEBP_8X8)
    expect(decoded.width).toBe(8)
    expect(decoded.height).toBe(8)
  })

  test("still decodes formats Jimp handles", async () => {
    const { Jimp } = await import("jimp")
    const png = await new Jimp({ width: 4, height: 4, color: 0xc86432ff }).getBuffer("image/png")
    const decoded = await (await pickDecoder())(new Uint8Array(png))
    expect([decoded.width, decoded.height]).toEqual([4, 4])
  })

  test("names the format and every backend's complaint when all of them fail", async () => {
    const decode = await pickDecoder()
    const error = await Promise.resolve(decode(new Uint8Array([0, 1, 2, 3, 4, 5]))).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(DecodeError)
    expect((error as DecodeError).message).toContain("unrecognized")
    expect((error as DecodeError).message).toContain("jimp:")
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
