/**
 * Helper: build a {@link PixelImage} of a single solid colour. Useful as a
 * deterministic input for round-trip encoder tests.
 */
import { createPixelImage, type PixelImage } from "../src/pixels"

export function solidImage(width: number, height: number, r: number, g: number, b: number, a = 255): PixelImage {
  return createPixelImage(width, height, [r, g, b, a])
}

export function gradientImage(width: number, height: number): PixelImage {
  const image = createPixelImage(width, height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      image.data[i] = Math.round((x / Math.max(1, width - 1)) * 255)
      image.data[i + 1] = Math.round((y / Math.max(1, height - 1)) * 255)
      image.data[i + 2] = 128
      image.data[i + 3] = 255
    }
  }
  return image
}

export function checkeredImage(width: number, height: number, cell = 4): PixelImage {
  const image = createPixelImage(width, height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const dark = (Math.floor(x / cell) + Math.floor(y / cell)) % 2 === 0
      image.data[i] = dark ? 32 : 220
      image.data[i + 1] = dark ? 32 : 220
      image.data[i + 2] = dark ? 48 : 200
      image.data[i + 3] = 255
    }
  }
  return image
}
