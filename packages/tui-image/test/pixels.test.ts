import { describe, expect, it, test } from "bun:test"
import { createPixelImage, crop, resize, resizeArea, resizeNearest } from "../src/pixels"
import { solidImage } from "./_fixtures"

describe("createPixelImage", () => {
  test("creates an image filled with the requested colour", () => {
    const image = createPixelImage(4, 4, [10, 20, 30, 255])
    expect(image.data.length).toBe(64)
    for (let i = 0; i < image.data.length; i += 4) {
      expect(image.data[i]).toBe(10)
      expect(image.data[i + 1]).toBe(20)
      expect(image.data[i + 2]).toBe(30)
      expect(image.data[i + 3]).toBe(255)
    }
  })

  test("rejects non-positive dimensions", () => {
    expect(() => createPixelImage(0, 1)).toThrow()
    expect(() => createPixelImage(1, 0)).toThrow()
  })
})

describe("resize", () => {
  test("returns the same image when dimensions match", () => {
    const image = solidImage(4, 4, 1, 2, 3)
    const out = resize(image, 4, 4)
    expect(out).toBe(image)
  })

  test("nearest produces pixel-exact output", () => {
    const image = solidImage(2, 2, 200, 100, 50)
    const out = resizeNearest(image, 4, 4)
    for (let i = 0; i < out.data.length; i += 4) {
      expect(out.data[i]).toBe(200)
      expect(out.data[i + 1]).toBe(100)
      expect(out.data[i + 2]).toBe(50)
    }
  })

  test("bilinear produces correctly-sized image", () => {
    const image = solidImage(10, 10, 50, 100, 150)
    const out = resize(image, 5, 5)
    expect(out.width).toBe(5)
    expect(out.height).toBe(5)
    expect(out.data.length).toBe(5 * 5 * 4)
  })
})

describe("crop", () => {
  test("crops the requested region", () => {
    const image = createPixelImage(4, 4, [255, 0, 0, 255])
    const out = crop(image, 1, 1, 2, 2)
    expect(out.width).toBe(2)
    expect(out.height).toBe(2)
    expect(out.data.length).toBe(16)
  })
})

describe("resize picks a filter by direction", () => {
  it("averages every contributing pixel when shrinking", () => {
    // A 4x1 strip of two blacks then two whites, halved: each output pixel is
    // the mean of the two it covers, so both are mid-grey. Bilinear would have
    // read only the first of each pair and returned black, white.
    const image = createPixelImage(4, 1)
    image.data.set([0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255, 255, 255, 255, 255, 255])
    const out = resize(image, 2, 1)
    expect(out.data[0]).toBe(0)
    expect(out.data[4]).toBe(255)
    expect(resizeArea(image, 1, 1).data[0]).toBe(128)
  })

  it("does not drop a lone bright pixel when shrinking hard", () => {
    // A single white pixel in a 16x16 black field, shrunk to 2x2. Point-ish
    // sampling misses it entirely; averaging keeps it as a faint value.
    const image = createPixelImage(16, 16)
    for (let i = 3; i < image.data.length; i += 4) image.data[i] = 255
    const i = (5 * 16 + 5) * 4
    image.data[i] = 255
    image.data[i + 1] = 255
    image.data[i + 2] = 255
    const out = resize(image, 2, 2)
    expect([...out.data].some((v, index) => index % 4 !== 3 && v > 0)).toBe(true)
  })

  it("still interpolates when enlarging", () => {
    const image = createPixelImage(2, 1)
    image.data.set([0, 0, 0, 255, 255, 255, 255, 255])
    const out = resize(image, 4, 1)
    // A mid sample must land strictly between the endpoints.
    expect(out.data[4]).toBeGreaterThan(0)
    expect(out.data[4]).toBeLessThan(255)
  })
})
