/**
 * High-level image rendering for the terminal.
 *
 * This module is the one nikcli's TUI calls. It ties together:
 *  - {@link detectCapabilities} (in `capabilities.ts`) to pick the best protocol,
 *  - a {@link Decoder} (in `decode.ts`) to convert image bytes into a
 *    {@link PixelImage},
 *  - one of the encoders in `encode.ts` to produce the terminal output.
 *
 * The function {@link renderImage} is the public entry point. The lower-level
 * pieces are exported so unit tests can target them in isolation.
 */
import { detectCapabilities, Protocol, type Capabilities, type StreamProbe } from "./capabilities"
import type { PixelImage } from "./pixels"
import { crop, resize } from "./pixels"
import {
  encodeAsciiBlocks,
  encodeBraille,
  encodeHalfblock,
  encodeIterm2,
  encodeKitty,
  encodeSixel,
  type AsciiBlocksOptions,
  type BrailleOptions,
  type HalfBlockOptions,
  type Iterm2Options,
  type KittyOptions,
} from "./encode"
import { jimpDecoder, pickDecoder, type Decoder } from "./decode"

export type RendererKind = "kitty" | "sixel" | "iterm2" | "halfblock" | "braille" | "ascii"

export interface CommonOptions {
  /** Terminal width in cells. When omitted we read `process.stdout.columns`. */
  readonly columns?: number
  /** Terminal height in cells. When omitted we read `process.stdout.rows`. */
  readonly rows?: number
  /** Force a specific renderer. */
  readonly renderer?: RendererKind
  /** Override the default decoder. */
  readonly decoder?: Decoder
  /** Whether the bytes will be written to `stderr`. */
  readonly stream?: StreamProbe
  /** Pre-computed capabilities — skips the env heuristic. */
  readonly capabilities?: Capabilities
  /**
   * When `false`, the image is left at the device's natural size. Defaults to
   * `true` (fit to the requested cells while preserving aspect ratio).
   */
  readonly fit?: boolean
  /**
   * When `true`, force WASM-backed decoding even when Jimp is available.
   */
  readonly preferWasm?: boolean
  /** Max image side length in cells (clamps the requested size). */
  readonly maxDimension?: number
}

export interface RenderImageOptions extends CommonOptions {
  /** Source bytes (PNG, JPEG, GIF, WebP, BMP, SVG). */
  readonly input: Uint8Array
  /**
   * Optional source size override — useful when the input is an SVG (no
   * intrinsic pixel size) or when the caller has pre-measured the image.
   */
  readonly width?: number
  readonly height?: number
}

export interface RenderImageResult {
  /** Encoded terminal output. */
  readonly output: string | Uint8Array
  /** Renderer that produced the output. */
  readonly renderer: RendererKind
  /** The protocol that was used (or `null` for fallback renderers). */
  readonly protocol: Protocol | null
  /** Width of the output in cells / pixels (varies per renderer). */
  readonly columns: number
  /** Height of the output in cells / pixels. */
  readonly rows: number
  /** Detected capabilities. */
  readonly capabilities: Capabilities
}

function readDimensions(options: CommonOptions): {
  columns: number
  rows: number
} {
  const stdout = typeof process !== "undefined" ? process.stdout : undefined
  const columns = options.columns ?? stdout?.columns ?? 80
  const rows = options.rows ?? stdout?.rows ?? 24
  const max = options.maxDimension
  return {
    columns: max ? Math.min(columns, max) : columns,
    rows: max ? Math.min(rows, max) : rows,
  }
}

function fitDimensions(
  image: PixelImage,
  columns: number,
  rows: number,
): { columns: number; rows: number; pixelWidth: number; pixelHeight: number } {
  if (columns <= 0) throw new RangeError(`columns must be positive, got ${columns}`)
  if (rows <= 0) throw new RangeError(`rows must be positive, got ${rows}`)
  // Native protocols (Kitty, Sixel, iTerm2) map 1 cell → 1 pixel, so we leave
  // the cell size as-is. The half-block renderer fits the source image to
  // `columns × (rows * 2)` because each cell encodes two vertical pixels.
  // The braille renderer maps to `columns * 2 × rows * 4`.
  return {
    columns,
    rows,
    pixelWidth: columns,
    pixelHeight: rows,
  }
}

function fitCellDimensions(
  image: PixelImage,
  columns: number,
  rows: number,
  mode: "halfblock" | "braille" | "ascii",
): { columns: number; rows: number; pixelWidth: number; pixelHeight: number } {
  const aspect = image.width / image.height
  const cellAspect = mode === "halfblock" ? 2 : mode === "braille" ? 1 : 2
  // For half-block, each cell is 2 px tall × 1 px wide. So a 100×50 image
  // wants 100 columns × 25 rows.
  const sourceRows = mode === "halfblock" ? image.height / 2 : mode === "braille" ? image.height / 4 : image.height
  const cols = Math.max(1, Math.min(columns, image.width))
  const r = Math.max(1, Math.min(rows, Math.round(cols / (aspect * cellAspect))))
  const heightRows = Math.max(1, Math.min(rows, sourceRows))
  if (r <= heightRows) {
    return { columns: cols, rows: r, pixelWidth: cols, pixelHeight: r }
  }
  return {
    columns: cols,
    rows: heightRows,
    pixelWidth: cols,
    pixelHeight: heightRows,
  }
}

function pickRenderer(
  options: CommonOptions,
  capabilities: Capabilities,
): { renderer: RendererKind; protocol: Protocol | null } {
  if (options.renderer) {
    const protocol =
      options.renderer === "kitty"
        ? Protocol.KITTY
        : options.renderer === "sixel"
          ? Protocol.SIXEL
          : options.renderer === "iterm2"
            ? Protocol.ITERM2
            : null
    return { renderer: options.renderer, protocol }
  }
  if (capabilities.best === Protocol.KITTY) return { renderer: "kitty", protocol: Protocol.KITTY }
  if (capabilities.best === Protocol.SIXEL) return { renderer: "sixel", protocol: Protocol.SIXEL }
  if (capabilities.best === Protocol.ITERM2) return { renderer: "iterm2", protocol: Protocol.ITERM2 }
  // Fall back to half-block — best of the cell-based renderers.
  return { renderer: "halfblock", protocol: null }
}

function cover(image: PixelImage, targetWidth: number, targetHeight: number): PixelImage {
  const sourceAspect = image.width / image.height
  const targetAspect = targetWidth / targetHeight
  let cropWidth = image.width
  let cropHeight = image.height
  if (sourceAspect > targetAspect) {
    cropWidth = Math.round(image.height * targetAspect)
  } else {
    cropHeight = Math.round(image.width / targetAspect)
  }
  const offsetX = Math.max(0, Math.floor((image.width - cropWidth) / 2))
  const offsetY = Math.max(0, Math.floor((image.height - cropHeight) / 2))
  return resize(crop(image, offsetX, offsetY, cropWidth, cropHeight), targetWidth, targetHeight)
}

/**
 * Render an image to the terminal. The function returns a string for the
 * cell-based renderers and a `Uint8Array` for Sixel.
 */
export async function renderImage(options: RenderImageOptions): Promise<RenderImageResult> {
  const capabilities = options.capabilities ?? detectCapabilities(options.stream)
  const decoder = options.decoder ?? (await pickDecoder({ preferWasm: options.preferWasm }))
  const image = await decoder(options.input)
  if (image.width <= 0 || image.height <= 0) {
    throw new RangeError("decoder produced a zero-sized image")
  }

  const { columns, rows } = readDimensions(options)
  const { renderer, protocol } = pickRenderer(options, capabilities)
  const fitted = fitDimensions(image, columns, rows)

  // The native protocols scale to fit; cell-based renderers apply their own
  // per-cell aspect math. The `fit` flag is honoured for cell-based renderers
  // by always resizing the source.
  const shouldFit = options.fit !== false

  let result: RenderImageResult
  switch (renderer) {
    case "kitty": {
      const target = shouldFit ? cover(image, fitted.columns, fitted.rows) : image
      const kittyOptions: KittyOptions = {
        columns: fitted.columns,
        rows: fitted.rows,
        format: "png",
        fresh: true,
      }
      const out = encodeKitty(target, kittyOptions)
      result = {
        output: out,
        renderer,
        protocol,
        columns: fitted.columns,
        rows: fitted.rows,
        capabilities,
      }
      break
    }
    case "sixel": {
      const target = shouldFit ? cover(image, fitted.columns, fitted.rows) : image
      const out = encodeSixel(target)
      result = {
        output: out,
        renderer,
        protocol,
        columns: fitted.columns,
        rows: fitted.rows,
        capabilities,
      }
      break
    }
    case "iterm2": {
      const target = shouldFit ? cover(image, fitted.columns, fitted.rows) : image
      const iterm2Options: Iterm2Options = {
        width: fitted.columns,
        height: fitted.rows,
        preserveAspectRatio: true,
      }
      const out = encodeIterm2(target, iterm2Options)
      result = {
        output: out,
        renderer,
        protocol,
        columns: fitted.columns,
        rows: fitted.rows,
        capabilities,
      }
      break
    }
    case "halfblock": {
      const dims = fitCellDimensions(image, columns, rows, "halfblock")
      const target = shouldFit ? cover(image, dims.pixelWidth, dims.pixelHeight * 2) : image
      const halfOptions: HalfBlockOptions = {
        columns: dims.columns,
        rows: dims.rows,
        truecolor: true,
      }
      const out = encodeHalfblock(target, halfOptions)
      result = {
        output: out,
        renderer,
        protocol,
        columns: dims.columns,
        rows: dims.rows,
        capabilities,
      }
      break
    }
    case "braille": {
      const dims = fitCellDimensions(image, columns, rows, "braille")
      const target = shouldFit ? cover(image, dims.pixelWidth * 2, dims.pixelHeight * 4) : image
      const brailleOptions: BrailleOptions = {
        columns: dims.columns,
        rows: dims.rows,
      }
      const out = encodeBraille(target, brailleOptions)
      result = {
        output: out,
        renderer,
        protocol,
        columns: dims.columns,
        rows: dims.rows,
        capabilities,
      }
      break
    }
    case "ascii": {
      const dims = fitCellDimensions(image, columns, rows, "ascii")
      const target = shouldFit ? cover(image, dims.pixelWidth, dims.pixelHeight) : image
      const asciiOptions: AsciiBlocksOptions = {
        columns: dims.columns,
        rows: dims.rows,
      }
      const out = encodeAsciiBlocks(target, asciiOptions)
      result = {
        output: out,
        renderer,
        protocol,
        columns: dims.columns,
        rows: dims.rows,
        capabilities,
      }
      break
    }
  }
  return result
}

export { jimpDecoder, pickDecoder, type Decoder, type DecodeError } from "./decode"
export {
  detectCapabilities,
  Protocol,
  type Capabilities,
  type Protocol as ProtocolType,
  type StreamProbe,
} from "./capabilities"
export {
  encodeAsciiBlocks,
  encodeBraille,
  encodeHalfblock,
  encodeIterm2,
  encodeKitty,
  encodeSixel,
  type AsciiBlocksOptions,
  type BrailleOptions,
  type HalfBlockOptions,
  type Iterm2Options,
  type KittyOptions,
} from "./encode"
export { createPixelImage, crop, resize, type PixelImage } from "./pixels"
