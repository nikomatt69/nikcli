/**
 * Image decoders. A {@link Decoder} takes a raw byte buffer (PNG, JPEG, GIF,
 * WebP, BMP, …) and returns a {@link PixelImage}.
 *
 * The package ships with three decoders out of the box:
 *
 *  - {@link bunDecoder} — Bun.Image (1.4+) to PNG, then Jimp for RGBA pixels.
 *  - {@link jimpDecoder} — pure-JS, always available.
 *  - {@link photonDecoder} — WASM fallback when Bun.Image / Jimp cannot read a container.
 */
import type { PixelImage } from "./pixels"

export type Decoder = (bytes: Uint8Array) => Promise<PixelImage> | PixelImage

export class DecodeError extends Error {
  constructor(
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message)
    this.name = "DecodeError"
  }
}

interface DecodedBitmap {
  width: number
  height: number
  data: Uint8ClampedArray | Uint8Array | Buffer
}

/**
 * Bun.Image decoder. Converts any supported container to PNG off-thread, then
 * reuses Jimp for RGBA pixels (Bun.Image has no raw-pixel terminal).
 */
export const bunDecoder: Decoder = async (bytes) => {
  const Image = (Bun as unknown as { Image?: new (input: Uint8Array) => { png(): { bytes(): Promise<Uint8Array> } } })
    .Image
  if (typeof Image !== "function") throw new DecodeError("Bun.Image is not available")
  try {
    const png = await new Image(bytes.slice()).png().bytes()
    return jimpDecoder(png)
  } catch (error) {
    throw new DecodeError("Bun.Image failed to decode image", error)
  }
}

/**
 * Jimp decoder. Lazy-imports `jimp` so the rest of the package works even
 * if Jimp has not been installed (e.g. in a browser context where the user
 * supplied their own decoder).
 */
export const jimpDecoder: Decoder = async (bytes) => {
  try {
    const { Jimp } = await import("jimp")
    const image = await Jimp.read(Buffer.from(bytes))
    const w = image.bitmap.width
    const h = image.bitmap.height
    if (w === 0 || h === 0) throw new DecodeError("decoder returned a zero-sized image")
    // Jimp's `bitmap.data` is already a `Buffer` (Uint8Array) of RGBA bytes.
    const data = new Uint8ClampedArray(
      image.bitmap.data.buffer,
      image.bitmap.data.byteOffset,
      image.bitmap.data.byteLength,
    )
    return { width: w, height: h, data }
  } catch (error) {
    throw new DecodeError("jimp failed to decode image", error)
  }
}

/**
 * Photon-node (WASM) decoder. Lazily loads `@silvia-odwyer/photon-node`; if
 * the optional dependency is not installed we surface a clear error so the
 * caller can fall back to Jimp.
 */
export const photonDecoder: Decoder = async (bytes) => {
  let photon: typeof import("@silvia-odwyer/photon-node")
  try {
    photon = await import("@silvia-odwyer/photon-node")
  } catch (error) {
    throw new DecodeError(
      "photon-node is not installed; install it as an optional dependency or use jimpDecoder",
      error,
    )
  }
  try {
    const image = photon.PhotonImage.new_from_byteslice(Buffer.from(bytes))
    const width = image.get_width()
    const height = image.get_height()
    const raw = image.get_raw_pixels() // returns Uint8Array of RGBA
    const data = new Uint8ClampedArray(raw.buffer, raw.byteOffset, raw.byteLength)
    image.free()
    return { width, height, data }
  } catch (error) {
    throw new DecodeError("photon-node failed to decode image", error)
  }
}

/**
 * Resvg-js (WASM) decoder — used for SVG input. The optional dependency is
 * loaded lazily; if it is not installed we fall back to throwing a
 * `DecodeError`.
 */
export const resvgDecoder: Decoder = async (bytes) => {
  let resvg: typeof import("@resvg/resvg-js")
  try {
    resvg = await import("@resvg/resvg-js")
  } catch (error) {
    throw new DecodeError("resvg-js is not installed; install it as an optional dependency or use jimpDecoder", error)
  }
  try {
    const text = new TextDecoder("utf-8").decode(bytes)
    const renderer = new resvg.Resvg(text, { fitTo: { mode: "original" } })
    const rendered = renderer.render()
    const png = rendered.asPng()
    // Recurse into jimpDecoder for the actual raster decode.
    return jimpDecoder(new Uint8Array(png))
  } catch (error) {
    throw new DecodeError("resvg-js failed to decode image", error)
  }
}

export type ImageFormat = "png" | "jpeg" | "gif" | "bmp" | "tiff" | "webp" | "svg"

/** Formats {@link jimpDecoder} can actually read. Notably **not** WebP. */
export const JIMP_FORMATS: ReadonlySet<ImageFormat> = new Set<ImageFormat>(["png", "jpeg", "gif", "bmp", "tiff"])

function ascii(bytes: Uint8Array, offset: number, text: string) {
  for (let index = 0; index < text.length; index++) {
    if (bytes[offset + index] !== text.charCodeAt(index)) return false
  }
  return true
}

/**
 * Sniff the container from the leading bytes. File extensions lie (and a
 * `.png` handed to us over HTTP is routinely a WebP), so decoder selection
 * goes by magic number.
 */
export function detectFormat(bytes: Uint8Array): ImageFormat | undefined {
  if (bytes.length >= 12) {
    if (bytes[0] === 0x89 && ascii(bytes, 1, "PNG")) return "png"
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return "jpeg"
    if (ascii(bytes, 0, "GIF8")) return "gif"
    if (ascii(bytes, 0, "BM")) return "bmp"
    if (bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a) return "tiff"
    if (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[3] === 0x2a) return "tiff"
    if (ascii(bytes, 0, "RIFF") && ascii(bytes, 8, "WEBP")) return "webp"
  }
  // SVG is text, and may lead with a BOM, whitespace, an XML prolog or a comment.
  const head = new TextDecoder("utf-8").decode(bytes.subarray(0, 512)).replace(/^﻿/, "").trimStart()
  if (head.startsWith("<?xml") || head.startsWith("<svg") || head.startsWith("<!--")) return "svg"
  return undefined
}

export interface PickOptions {
  /** When `true`, prefer the WASM-backed photon decoder if available. */
  readonly preferWasm?: boolean
}

function reason(error: unknown): string {
  if (error instanceof DecodeError && error.cause) return reason(error.cause)
  return error instanceof Error ? error.message : String(error)
}

function hasBunImage() {
  return typeof (Bun as unknown as { Image?: unknown }).Image === "function"
}

function candidates(format: ImageFormat | undefined, preferWasm: boolean) {
  const bun = { name: "bun", decoder: bunDecoder }
  const jimp = { name: "jimp", decoder: jimpDecoder }
  const photon = { name: "photon", decoder: photonDecoder }
  if (format === "svg") {
    return [{ name: "resvg", decoder: resvgDecoder }, ...(hasBunImage() ? [bun] : []), photon]
  }
  if (hasBunImage()) {
    return preferWasm || (format !== undefined && !JIMP_FORMATS.has(format)) ? [bun, photon, jimp] : [bun, jimp, photon]
  }
  if (preferWasm || (format !== undefined && !JIMP_FORMATS.has(format))) return [photon, jimp]
  return [jimp, photon]
}

/**
 * Choose the best decoder available in the current environment: a decoder that
 * sniffs the bytes, calls whichever backend can handle that container, and
 * falls back to the other one. When every backend refuses, the error names the
 * format and quotes each backend's own complaint — "jimp failed to decode
 * image" on its own says nothing about why.
 */
export async function pickDecoder(options: PickOptions = {}): Promise<Decoder> {
  const preferWasm = options.preferWasm === true
  return async (bytes) => {
    const format = detectFormat(bytes)
    const failures: string[] = []
    for (const candidate of candidates(format, preferWasm)) {
      try {
        return await candidate.decoder(bytes)
      } catch (error) {
        failures.push(`${candidate.name}: ${reason(error)}`)
      }
    }
    throw new DecodeError(`cannot decode ${format ?? "unrecognized"} image (${failures.join("; ")})`)
  }
}
