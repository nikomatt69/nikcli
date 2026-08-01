/**
 * Pixel buffer types used by the {@link renderImage} pipeline.
 *
 * The encoder/decoder split is deliberate: keeping the pixel data as a plain
 * `Uint8ClampedArray` of RGBA bytes means the public API is independent of
 * Jimp, sharp, photon-node, the browser `ImageData`, or any other concrete
 * image library. The {@link decode} helpers in `decode.ts` take a `Uint8Array`
 * and return a {@link PixelImage}; the encoders consume {@link PixelImage}.
 */
export interface PixelImage {
  /** Source width in pixels. */
  readonly width: number
  /** Source height in pixels. */
  readonly height: number
  /**
   * Row-major RGBA pixel data, 4 bytes per pixel. Alpha is *premultiplied* by
   * the decoder when it returns a {@link PixelImage}; encoders rely on
   * `alpha === 0` to mean "fully transparent".
   */
  readonly data: Uint8ClampedArray
}

export function createPixelImage(width: number, height: number, fill?: [number, number, number, number]): PixelImage {
  if (!Number.isInteger(width) || width <= 0) throw new RangeError(`width must be a positive integer, got ${width}`)
  if (!Number.isInteger(height) || height <= 0) throw new RangeError(`height must be a positive integer, got ${height}`)
  const data = new Uint8ClampedArray(width * height * 4)
  if (fill) {
    const [r, g, b, a] = fill
    for (let i = 0; i < data.length; i += 4) {
      data[i] = r
      data[i + 1] = g
      data[i + 2] = b
      data[i + 3] = a
    }
  }
  return { width, height, data }
}

export function pixelAt(image: PixelImage, x: number, y: number): [number, number, number, number] {
  const i = (y * image.width + x) * 4
  return [image.data[i] ?? 0, image.data[i + 1] ?? 0, image.data[i + 2] ?? 0, image.data[i + 3] ?? 0]
}

export function setPixel(image: PixelImage, x: number, y: number, rgba: [number, number, number, number]): void {
  const i = (y * image.width + x) * 4
  image.data[i] = rgba[0]
  image.data[i + 1] = rgba[1]
  image.data[i + 2] = rgba[2]
  image.data[i + 3] = rgba[3]
}

export function resizeNearest(image: PixelImage, targetWidth: number, targetHeight: number): PixelImage {
  const out = createPixelImage(targetWidth, targetHeight)
  const xRatio = image.width / targetWidth
  const yRatio = image.height / targetHeight
  for (let y = 0; y < targetHeight; y++) {
    const srcY = Math.min(image.height - 1, Math.floor(y * yRatio))
    for (let x = 0; x < targetWidth; x++) {
      const srcX = Math.min(image.width - 1, Math.floor(x * xRatio))
      const src = (srcY * image.width + srcX) * 4
      const dst = (y * targetWidth + x) * 4
      out.data[dst] = image.data[src] ?? 0
      out.data[dst + 1] = image.data[src + 1] ?? 0
      out.data[dst + 2] = image.data[src + 2] ?? 0
      out.data[dst + 3] = image.data[src + 3] ?? 0
    }
  }
  return out
}

export function resizeBilinear(image: PixelImage, targetWidth: number, targetHeight: number): PixelImage {
  const out = createPixelImage(targetWidth, targetHeight)
  const xRatio = image.width / targetWidth
  const yRatio = image.height / targetHeight
  for (let y = 0; y < targetHeight; y++) {
    const srcFy = y * yRatio
    const y0 = Math.min(image.height - 1, Math.floor(srcFy))
    const y1 = Math.min(image.height - 1, y0 + 1)
    const wy = srcFy - y0
    for (let x = 0; x < targetWidth; x++) {
      const srcFx = x * xRatio
      const x0 = Math.min(image.width - 1, Math.floor(srcFx))
      const x1 = Math.min(image.width - 1, x0 + 1)
      const wx = srcFx - x0
      const i00 = (y0 * image.width + x0) * 4
      const i10 = (y0 * image.width + x1) * 4
      const i01 = (y1 * image.width + x0) * 4
      const i11 = (y1 * image.width + x1) * 4
      const dst = (y * targetWidth + x) * 4
      for (let c = 0; c < 4; c++) {
        const v0 = (image.data[i00 + c] ?? 0) * (1 - wx) + (image.data[i10 + c] ?? 0) * wx
        const v1 = (image.data[i01 + c] ?? 0) * (1 - wx) + (image.data[i11 + c] ?? 0) * wx
        out.data[dst + c] = Math.round(v0 * (1 - wy) + v1 * wy)
      }
    }
  }
  return out
}

/**
 * Resize using the highest-quality strategy available. {@link resizeBilinear}
 * is pure JS and dependency-free; the caller can swap in a WASM-backed
 * `resizer` for production use (see `decode.ts`).
 */
/**
 * Box-average (area) resample: every destination pixel is the mean of the
 * source rectangle it covers.
 *
 * This is the only correct way to *shrink*. Bilinear reads a 2×2 neighbourhood
 * regardless of scale, so shrinking by more than half skips most source pixels
 * entirely — which is point sampling with a little blur on top, and it aliases:
 * thin lines flicker or vanish, text turns to speckle. Averaging looks at every
 * pixel that contributes, which is what makes a shrunk picture look smooth
 * rather than pixelated.
 */
export function resizeArea(image: PixelImage, targetWidth: number, targetHeight: number): PixelImage {
  const out = createPixelImage(targetWidth, targetHeight)
  const xRatio = image.width / targetWidth
  const yRatio = image.height / targetHeight
  for (let y = 0; y < targetHeight; y++) {
    const y0 = Math.floor(y * yRatio)
    const y1 = Math.max(y0 + 1, Math.min(image.height, Math.ceil((y + 1) * yRatio)))
    for (let x = 0; x < targetWidth; x++) {
      const x0 = Math.floor(x * xRatio)
      const x1 = Math.max(x0 + 1, Math.min(image.width, Math.ceil((x + 1) * xRatio)))
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      let count = 0
      for (let sy = y0; sy < y1; sy++) {
        const row = sy * image.width
        for (let sx = x0; sx < x1; sx++) {
          const i = (row + sx) * 4
          r += image.data[i] ?? 0
          g += image.data[i + 1] ?? 0
          b += image.data[i + 2] ?? 0
          a += image.data[i + 3] ?? 0
          count++
        }
      }
      if (count === 0) count = 1
      const dst = (y * targetWidth + x) * 4
      out.data[dst] = Math.round(r / count)
      out.data[dst + 1] = Math.round(g / count)
      out.data[dst + 2] = Math.round(b / count)
      out.data[dst + 3] = Math.round(a / count)
    }
  }
  return out
}

export function resize(image: PixelImage, targetWidth: number, targetHeight: number): PixelImage {
  if (targetWidth === image.width && targetHeight === image.height) return image
  if (targetWidth <= 0 || targetHeight <= 0) {
    throw new RangeError(`target dimensions must be positive, got ${targetWidth}x${targetHeight}`)
  }
  // Shrinking and growing want opposite filters: averaging throws nothing away
  // on the way down, interpolation invents smooth values on the way up. Mixed
  // cases (narrower but taller) still shrink on one axis, so area wins there
  // too — it degenerates to a 1-pixel box on the axis that grew.
  if (targetWidth < image.width || targetHeight < image.height) {
    return resizeArea(image, targetWidth, targetHeight)
  }
  return resizeBilinear(image, targetWidth, targetHeight)
}

/**
 * Extract sub-rectangle and return as a new {@link PixelImage}. Used to
 * support `object-fit: cover` semantics in {@link fit}.
 */
export function crop(image: PixelImage, x: number, y: number, width: number, height: number): PixelImage {
  if (width <= 0 || height <= 0) {
    throw new RangeError(`crop dimensions must be positive, got ${width}x${height}`)
  }
  const out = createPixelImage(width, height)
  for (let row = 0; row < height; row++) {
    const srcRow = Math.min(image.height - 1, Math.max(0, y + row))
    for (let col = 0; col < width; col++) {
      const srcCol = Math.min(image.width - 1, Math.max(0, x + col))
      const src = (srcRow * image.width + srcCol) * 4
      const dst = (row * width + col) * 4
      out.data[dst] = image.data[src] ?? 0
      out.data[dst + 1] = image.data[src + 1] ?? 0
      out.data[dst + 2] = image.data[src + 2] ?? 0
      out.data[dst + 3] = image.data[src + 3] ?? 0
    }
  }
  return out
}
