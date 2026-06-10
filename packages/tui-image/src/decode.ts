/**
 * Image decoders. A {@link Decoder} takes a raw byte buffer (PNG, JPEG, GIF,
 * WebP, BMP, …) and returns a {@link PixelImage}.
 *
 * The package ships with **two** decoders out of the box:
 *
 *  - {@link jimpDecoder} — pure-JS, always available. Uses the `jimp`
 *    dependency declared in `package.json`. A good default for Node / Bun.
 *  - {@link photonDecoder} — WASM-backed, faster on large images. Uses
 *    `@silvia-odwyer/photon-node`. The optional dependency is loaded lazily
 *    and falls back to a clear error when it isn't installed.
 *
 * Callers (including nikcli's `image-preview.tsx`) can pass any custom decoder
 * function. The {@link pickDecoder} helper chooses the right one for the
 * environment.
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

export interface PickOptions {
  /** When `true`, prefer the WASM-backed photon decoder if available. */
  readonly preferWasm?: boolean
}

/**
 * Choose the best decoder available in the current environment. The WASM
 * decoders (photon, resvg) are tried first when `preferWasm` is set; otherwise
 * the pure-JS Jimp decoder is used as the default.
 */
export async function pickDecoder(options: PickOptions = {}): Promise<Decoder> {
  if (options.preferWasm) {
    try {
      await import("@silvia-odwyer/photon-node")
      return photonDecoder
    } catch {
      // optional dep not installed; fall through
    }
  }
  return jimpDecoder
}
