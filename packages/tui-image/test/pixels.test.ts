import { describe, expect, test } from "bun:test";
import { createPixelImage, crop, resize, resizeNearest } from "../src/pixels";
import { solidImage } from "./_fixtures";

describe("createPixelImage", () => {
  test("creates an image filled with the requested colour", () => {
    const image = createPixelImage(4, 4, [10, 20, 30, 255]);
    expect(image.data.length).toBe(64);
    for (let i = 0; i < image.data.length; i += 4) {
      expect(image.data[i]).toBe(10);
      expect(image.data[i + 1]).toBe(20);
      expect(image.data[i + 2]).toBe(30);
      expect(image.data[i + 3]).toBe(255);
    }
  });

  test("rejects non-positive dimensions", () => {
    expect(() => createPixelImage(0, 1)).toThrow();
    expect(() => createPixelImage(1, 0)).toThrow();
  });
});

describe("resize", () => {
  test("returns the same image when dimensions match", () => {
    const image = solidImage(4, 4, 1, 2, 3);
    const out = resize(image, 4, 4);
    expect(out).toBe(image);
  });

  test("nearest produces pixel-exact output", () => {
    const image = solidImage(2, 2, 200, 100, 50);
    const out = resizeNearest(image, 4, 4);
    for (let i = 0; i < out.data.length; i += 4) {
      expect(out.data[i]).toBe(200);
      expect(out.data[i + 1]).toBe(100);
      expect(out.data[i + 2]).toBe(50);
    }
  });

  test("bilinear produces correctly-sized image", () => {
    const image = solidImage(10, 10, 50, 100, 150);
    const out = resize(image, 5, 5);
    expect(out.width).toBe(5);
    expect(out.height).toBe(5);
    expect(out.data.length).toBe(5 * 5 * 4);
  });
});

describe("crop", () => {
  test("crops the requested region", () => {
    const image = createPixelImage(4, 4, [255, 0, 0, 255]);
    const out = crop(image, 1, 1, 2, 2);
    expect(out.width).toBe(2);
    expect(out.height).toBe(2);
    expect(out.data.length).toBe(16);
  });
});
