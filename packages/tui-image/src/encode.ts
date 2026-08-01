/**
 * Pure-JS encoders that turn a {@link PixelImage} into the byte sequences the
 * terminal understands.
 *
 * Encoders are intentionally split from decoders: the input is always a
 * {@link PixelImage}, the output is always a `string` (or `Uint8Array` for
 * Sixel, which is binary). Each encoder can be unit-tested in isolation.
 *
 * Encoders exposed here:
 *  - {@link encodeKitty}   — Kitty Graphics Protocol (`APC G … ST`)
 *  - {@link encodeIterm2}  — iTerm2 inline images (`OSC 1337 … ST`)
 *  - {@link encodeSixel}   — DEC Sixel (binary)
 *  - {@link encodeHalfblock} — 24-bit color Unicode half-block fallback
 *  - {@link encodeBraille} — 24-bit color Unicode Braille fallback (used by
 *                             `image-preview.tsx` already)
 *  - {@link encodeAsciiBlocks} — generic ASCII block fallback
 */
import { crop, resize, type PixelImage } from "./pixels"

const ESC = "\x1b"
const ST = "\x1b\\"

/**
 * Kitty graphics escape: `ESC _G key=val,key=val;payload ESC \`. Control
 * keys are comma-separated; a single semicolon introduces the (optional)
 * payload. Always emits the seven-bit ST (`ESC \`), which every modern
 * terminal accepts.
 */
function apc(keys: string[], payload?: string): string {
  const control = keys.join(",")
  return payload === undefined ? `${ESC}_G${control}${ST}` : `${ESC}_G${control};${payload}${ST}`
}

function base64FromBytes(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64")
  }
  let binary = ""
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i] ?? 0)
  // btoa is available in both browsers and modern Bun/Node.
  return btoa(binary)
}

/** Convert RGBA buffer to a tightly-packed RGB buffer (drops alpha). */
function rgbaToRgb(image: PixelImage): Uint8Array {
  const out = new Uint8Array(image.width * image.height * 3)
  for (let i = 0, j = 0; i < image.data.length; i += 4, j += 3) {
    const a = (image.data[i + 3] ?? 0) / 255
    out[j] = Math.round((image.data[i] ?? 0) * a)
    out[j + 1] = Math.round((image.data[i + 1] ?? 0) * a)
    out[j + 2] = Math.round((image.data[i + 2] ?? 0) * a)
  }
  return out
}

/** Convert RGBA buffer to PNG bytes. Implemented as a small dependency-free writer. */
function rgbaToPng(image: PixelImage): Uint8Array {
  return new U_PngEncoder(image.width, image.height).encode(image.data)
}

/**
 * Tiny, dependency-free PNG encoder. Only handles the 8-bit RGBA channel type
 * we produce internally — that's all Kitty / iTerm2 / Sixel need.
 *
 * The encoder follows the W3C PNG spec (third edition). It produces a single
 * IDAT chunk using zlib's `Stored` blocks so we don't need a deflate
 * dependency; the resulting bytes are uncompressed inside zlib, which is
 * perfectly legal and ~10% larger than deflate — fine for small previews.
 */
class U_PngEncoder {
  private static readonly CRC_TABLE: Uint32Array = (() => {
    const table = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      table[n] = c >>> 0
    }
    return table
  })()

  constructor(
    private readonly width: number,
    private readonly height: number,
  ) {}

  private static crc32(bytes: Uint8Array): number {
    let crc = 0xffffffff
    for (let i = 0; i < bytes.length; i++) {
      crc = U_PngEncoder.CRC_TABLE[(crc ^ (bytes[i] ?? 0)) & 0xff]! ^ (crc >>> 8)
    }
    return (crc ^ 0xffffffff) >>> 0
  }

  private chunk(type: string, data: Uint8Array): Uint8Array {
    const out = new Uint8Array(4 + 4 + data.length + 4)
    const dv = new DataView(out.buffer)
    dv.setUint32(0, data.length)
    out.set(new TextEncoder().encode(type), 4)
    out.set(data, 8)
    const crcInput = new Uint8Array(4 + data.length)
    crcInput.set(out.subarray(4, 8 + data.length), 0)
    dv.setUint32(8 + data.length, U_PngEncoder.crc32(crcInput))
    return out
  }

  private ihdr(): Uint8Array {
    const buf = new Uint8Array(13)
    const dv = new DataView(buf.buffer)
    dv.setUint32(0, this.width)
    dv.setUint32(4, this.height)
    buf[8] = 8 // bit depth
    buf[9] = 6 // color type: RGBA
    buf[10] = 0
    buf[11] = 0
    buf[12] = 0
    return this.chunk("IHDR", buf)
  }

  private idat(rgba: Uint8ClampedArray): Uint8Array {
    // Filter byte (0 = None) precedes every scanline.
    const scanline = this.width * 4
    const raw = new Uint8Array((scanline + 1) * this.height)
    for (let y = 0; y < this.height; y++) {
      raw[y * (scanline + 1)] = 0
      raw.set(rgba.subarray(y * scanline, y * scanline + scanline), y * (scanline + 1) + 1)
    }
    return this.chunk("IDAT", zlibStore(raw))
  }

  private iend(): Uint8Array {
    return this.chunk("IEND", new Uint8Array(0))
  }

  encode(rgba: Uint8ClampedArray): Uint8Array {
    const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const total = 8 + this.ihdr().length + this.idat(rgba).length + this.iend().length
    const out = new Uint8Array(total)
    let offset = 0
    const write = (bytes: Uint8Array) => {
      out.set(bytes, offset)
      offset += bytes.length
    }
    write(signature)
    write(this.ihdr())
    write(this.idat(rgba))
    write(this.iend())
    return out
  }
}

/**
 * Wrap raw bytes in a single-member zlib stream using the `Stored` block
 * algorithm. This produces slightly larger output than deflate but requires
 * zero dependencies, which matters because the encoder runs in the browser
 * bundle and in the tiny TUI renderer thread.
 */
function zlibStore(input: Uint8Array): Uint8Array {
  const out: number[] = []
  // zlib header
  out.push(0x78, 0x01)

  const maxBlock = 0xffff
  for (let i = 0; i < input.length; i += maxBlock) {
    const remaining = Math.min(maxBlock, input.length - i)
    const last = i + remaining >= input.length ? 1 : 0
    // BTYPE=00, BFINAL=last → header byte is just `last`.
    out.push(last)
    out.push(remaining & 0xff, (remaining >>> 8) & 0xff)
    const complement = ~remaining & 0xffff
    out.push(complement & 0xff, (complement >>> 8) & 0xff)
    for (let j = 0; j < remaining; j++) out.push(input[i + j] ?? 0)
  }
  // adler32
  const adler = adler32(input)
  out.push((adler >>> 24) & 0xff, (adler >>> 16) & 0xff, (adler >>> 8) & 0xff, adler & 0xff)
  return new Uint8Array(out)
}

function adler32(bytes: Uint8Array): number {
  let a = 1
  let b = 0
  for (let i = 0; i < bytes.length; i++) {
    a = (a + (bytes[i] ?? 0)) % 65521
    b = (b + a) % 65521
  }
  return ((b << 16) | a) >>> 0
}

export interface KittyOptions {
  /** Source image id (defaults to a stable hash of the pixels). */
  readonly id?: number
  /** Image width in cells. Defaults to `image.width`. */
  readonly columns?: number
  /** Image height in cells. Defaults to `image.height`. */
  readonly rows?: number
  /** When `true`, the image is transmitted as PNG instead of raw RGBA. */
  readonly format?: "png" | "rgba"
  /** Suppress the placeholder character at the cursor position. */
  readonly quiet?: boolean
  /**
   * When `true`, the image is sent as a fresh `a=T` (transmit+display)
   * command. The default of `false` uses `a=t` (transmit only) and follows
   * up with a separate `a=p` (put) command, which is the pattern OpenTUI uses
   * to update the same image in place.
   */
  readonly fresh?: boolean
}

/**
 * Encode a {@link PixelImage} using the Kitty Graphics Protocol. The output
 * is a single string ready to write to stdout.
 *
 * Reference: <https://sw.kovidgoyal.net/kitty/graphics-protocol/>
 */
export function encodeKitty(image: PixelImage, options: KittyOptions = {}): string {
  const columns = Math.max(1, options.columns ?? image.width)
  const rows = Math.max(1, options.rows ?? image.height)
  const id = options.id ?? 1
  const fresh = options.fresh ?? false
  const quiet = options.quiet ? "q=1" : "q=2"

  // Kitty caps a single transmission at 4096 bytes of base64; we chunk to be
  // safe. Empirically small preview images fit in one chunk, but we always
  // go through the chunker so the encoder behaves identically for big inputs.
  // Kitty caps a single escape at 4096 bytes of base64. Per spec, the first
  // chunk carries every key plus `m=1`; continuation chunks carry ONLY `m`
  // (and the payload); the final chunk has `m=0`.
  const emitChunked = (head: string[], payload: string): string => {
    const chunkSize = 4096
    if (payload.length <= chunkSize) return apc(head, payload)
    const chunks: string[] = []
    for (let i = 0; i < payload.length; i += chunkSize) {
      const part = payload.slice(i, i + chunkSize)
      const more = i + chunkSize < payload.length ? 1 : 0
      chunks.push(i === 0 ? apc([...head, "m=1"], part) : apc([`m=${more}`], part))
    }
    return chunks.join("")
  }

  if (options.format === "rgba") {
    const rgb = rgbaToRgb(image)
    const payload = base64FromBytes(rgb)
    const head = [fresh ? "a=T" : "a=t", `f=24`, `s=${image.width}`, `v=${image.height}`, quiet, `i=${id}`]
    return emitChunked(head, payload) + apc(["a=p", `p=1`, `i=${id}`, `c=${columns}`, `r=${rows}`, quiet])
  }

  const png = rgbaToPng(image)
  const payload = base64FromBytes(png)
  const head = [fresh ? "a=T" : "a=t", `f=100`, `s=${image.width}`, `v=${image.height}`, quiet, `i=${id}`]
  return emitChunked(head, payload) + apc(["a=p", `p=1`, `i=${id}`, `c=${columns}`, `r=${rows}`, quiet])
}

export interface Iterm2Options {
  readonly width?: number | string
  readonly height?: number | string
  /** When `true`, the image is `inline=1` (preserves aspect ratio). */
  readonly preserveAspectRatio?: boolean
}

/**
 * Encode a {@link PixelImage} using the iTerm2 inline images protocol. The
 * output is a single string ready to write to stdout.
 *
 * Reference: <https://iterm2.com/documentation-images.html>
 */
export function encodeIterm2(image: PixelImage, options: Iterm2Options = {}): string {
  const png = rgbaToPng(image)
  return encodeIterm2Bytes(png, options)
}

/**
 * Encode already-compressed image bytes using the iTerm2 inline image
 * protocol. PNG/JPEG/GIF bytes can be forwarded directly, avoiding an
 * expensive decode/re-encode cycle and preserving the original image.
 */
export function encodeIterm2Bytes(image: Uint8Array, options: Iterm2Options = {}): string {
  const payload = base64FromBytes(image)
  const width = options.width ?? "auto"
  const height = options.height ?? "auto"
  const preserve = options.preserveAspectRatio !== false ? "1" : "0"
  const arguments_ = [
    `size=${image.byteLength}`,
    `width=${width}`,
    `height=${height}`,
    `preserveAspectRatio=${preserve}`,
    "inline=1",
  ].join(";")
  return `${ESC}]1337;File=${arguments_}:${payload}${ST}`
}

/**
 * Sixel palette quantiser. We don't ship a full median-cut implementation;
 * for previews a fixed 256-colour palette ordered by perceptual distance is
 * perfectly adequate. The palette below is the standard xterm 256-colour
 * palette.
 */
const SIXEL_PALETTE: ReadonlyArray<readonly [number, number, number]> = (() => {
  const out: [number, number, number][] = []
  for (let r = 0; r < 6; r++) {
    for (let g = 0; g < 6; g++) {
      for (let b = 0; b < 6; b++) {
        out.push([(r * 255) / 5, (g * 255) / 5, (b * 255) / 5])
      }
    }
  }
  for (let g = 0; g < 24; g++) out.push([(g * 255) / 23, (g * 255) / 23, (g * 255) / 23])
  return out
})()

function nearestPaletteIndex(r: number, g: number, b: number): number {
  let best = 0
  let bestDist = Number.POSITIVE_INFINITY
  for (let i = 0; i < SIXEL_PALETTE.length; i++) {
    const entry = SIXEL_PALETTE[i]!
    const dr = entry[0] - r
    const dg = entry[1] - g
    const db = entry[2] - b
    const dist = dr * dr + dg * dg + db * db
    if (dist < bestDist) {
      bestDist = dist
      best = i
    }
  }
  return best
}

/**
 * Encode a {@link PixelImage} as DEC Sixel. Returns raw bytes ready to write
 * to stdout. Each output row corresponds to 6 source pixels.
 *
 * Reference: <https://vt100.net/docs/vt3xx-gp/chapter14.html>
 */
export function encodeSixel(image: PixelImage): Uint8Array {
  const pixels = new Int16Array(image.width * image.height)
  pixels.fill(-1)
  const usedPalette = new Map<number, number>()
  // `nearestPaletteIndex` is a linear scan of 256 entries, and calling it once
  // per pixel dominates everything else here. Real pictures — screenshots,
  // rendered pages, UI — are made of far fewer distinct colours than pixels
  // (a web page is typically a few thousand), so memoising the answer per
  // colour turns `pixels × 256` comparisons into `colours × 256`.
  const nearest = new Map<number, number>()

  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const offset = (y * image.width + x) * 4
      const alpha = (image.data[offset + 3] ?? 0) / 255
      if (alpha < 0.5) continue
      const r = (image.data[offset] ?? 0) * alpha
      const g = (image.data[offset + 1] ?? 0) * alpha
      const b = (image.data[offset + 2] ?? 0) * alpha
      const key = ((r | 0) << 16) | ((g | 0) << 8) | (b | 0)
      let paletteIndex = nearest.get(key)
      if (paletteIndex === undefined) {
        paletteIndex = nearestPaletteIndex(r, g, b)
        nearest.set(key, paletteIndex)
      }
      let register = usedPalette.get(paletteIndex)
      if (register === undefined) {
        register = usedPalette.size
        usedPalette.set(paletteIndex, register)
      }
      pixels[y * image.width + x] = register
    }
  }

  const parts: number[] = []
  const push = (s: string) => {
    for (let i = 0; i < s.length; i++) parts.push(s.charCodeAt(i) & 0x7f)
  }
  const pushRun = (value: number, length: number) => {
    const char = String.fromCharCode(0x3f + value)
    push(length >= 4 ? `!${length}${char}` : char.repeat(length))
  }

  push("\x1bPq") // DECSIXEL introducer
  push(`"1;1;${image.width};${image.height}`)
  for (const [paletteIndex, register] of usedPalette) {
    const [r, g, b] = SIXEL_PALETTE[paletteIndex]!
    push(`#${register};2;${Math.round((r / 255) * 100)};${Math.round((g / 255) * 100)};${Math.round((b / 255) * 100)}`)
  }

  for (let y = 0; y < image.height; y += 6) {
    const bandRegisters = new Set<number>()
    for (let x = 0; x < image.width; x++) {
      for (let dy = 0; dy < 6; dy++) {
        const yy = y + dy
        if (yy >= image.height) break
        const register = pixels[yy * image.width + x] ?? -1
        if (register >= 0) bandRegisters.add(register)
      }
    }

    const registers = [...bandRegisters]
    for (let registerIndex = 0; registerIndex < registers.length; registerIndex++) {
      const register = registers[registerIndex]!
      push(`#${register}`)
      let runValue = -1
      let runLength = 0
      for (let x = 0; x < image.width; x++) {
        let value = 0
        for (let dy = 0; dy < 6; dy++) {
          const yy = y + dy
          if (yy >= image.height) break
          if (pixels[yy * image.width + x] === register) value |= 1 << dy
        }
        if (value === runValue) {
          runLength += 1
          continue
        }
        if (runLength > 0) pushRun(runValue, runLength)
        runValue = value
        runLength = 1
      }
      if (runLength > 0) pushRun(runValue, runLength)
      if (registerIndex < registers.length - 1) push("$")
    }
    if (y + 6 < image.height) push("-")
  }
  push("\x1b\\") // ST
  return new Uint8Array(parts)
}

export interface HalfBlockOptions {
  /** Width in terminal cells. */
  readonly columns: number
  /** Height in terminal cells. */
  readonly rows: number
  /** When `true`, emit 24-bit color escape sequences (default). */
  readonly truecolor?: boolean
}

/**
 * Encode a {@link PixelImage} using Unicode half-block characters. Each cell
 * encodes two vertical pixels (top + bottom). The output preserves aspect
 * ratio because terminal cells are roughly twice as tall as they are wide.
 */
export function encodeHalfblock(image: PixelImage, options: HalfBlockOptions): string {
  const { columns, rows } = options
  const truecolor = options.truecolor !== false
  const target = resize(image, columns, Math.max(1, rows * 2))
  const lines: string[] = []
  const reset = truecolor ? "\x1b[0m" : ""
  for (let y = 0; y < target.height; y += 2) {
    let line = ""
    for (let x = 0; x < target.width; x++) {
      const top = sample(target, x, y)
      const bottom = sample(target, x, y + 1)
      if (truecolor) {
        line += `\x1b[38;2;${top[0]};${top[1]};${top[2]}m\x1b[48;2;${bottom[0]};${bottom[1]};${bottom[2]}m\u2580`
      } else {
        line += "▀"
      }
    }
    lines.push(line + reset)
  }
  return lines.join("\n")
}

function sample(image: PixelImage, x: number, y: number): [number, number, number] {
  const yy = Math.max(0, Math.min(image.height - 1, y))
  const xx = Math.max(0, Math.min(image.width - 1, x))
  const i = (yy * image.width + xx) * 4
  const a = (image.data[i + 3] ?? 0) / 255
  return [
    Math.round((image.data[i] ?? 0) * a),
    Math.round((image.data[i + 1] ?? 0) * a),
    Math.round((image.data[i + 2] ?? 0) * a),
  ]
}

export interface BrailleOptions {
  readonly columns: number
  readonly rows: number
}

type RgbaColor = [r: number, g: number, b: number, a: number]

const BRAILLE_BITS: readonly (readonly [number, number])[] = [
  [0x01, 0x08],
  [0x02, 0x10],
  [0x04, 0x20],
  [0x40, 0x80],
]

function colorDistanceSq(a: RgbaColor, b: RgbaColor): number {
  const dr = a[0] - b[0]
  const dg = a[1] - b[1]
  const db = a[2] - b[2]
  const da = a[3] - b[3]
  return dr * dr + dg * dg + db * db + da * da
}

function averageColor(colors: RgbaColor[], indexes: number[]): RgbaColor {
  let r = 0
  let g = 0
  let b = 0
  let a = 0
  for (const index of indexes) {
    const color = colors[index]!
    r += color[0]
    g += color[1]
    b += color[2]
    a += color[3]
  }
  const count = Math.max(1, indexes.length)
  return [Math.round(r / count), Math.round(g / count), Math.round(b / count), Math.round(a / count)]
}

function brailleCell(colors: RgbaColor[]): {
  char: string
  fg: RgbaColor
  bg: RgbaColor
} {
  let darkest = 0
  let brightest = 0
  const luminance = (color: RgbaColor) => 0.2126 * color[0] + 0.7152 * color[1] + 0.0722 * color[2]

  for (let index = 1; index < colors.length; index++) {
    if (luminance(colors[index]!) < luminance(colors[darkest]!)) darkest = index
    if (luminance(colors[index]!) > luminance(colors[brightest]!)) brightest = index
  }

  if (colorDistanceSq(colors[darkest]!, colors[brightest]!) < 24 * 24 * 3) {
    const average = averageColor(
      colors,
      colors.map((_, index) => index),
    )
    return { char: "\u2800", fg: average, bg: average }
  }

  let centers: [RgbaColor, RgbaColor] = [colors[darkest]!, colors[brightest]!]
  let groups: [number[], number[]] = [[], []]
  for (let iteration = 0; iteration < 4; iteration++) {
    groups = [[], []]
    for (let index = 0; index < colors.length; index++) {
      const group = colorDistanceSq(colors[index]!, centers[0]) <= colorDistanceSq(colors[index]!, centers[1]) ? 0 : 1
      groups[group].push(index)
    }
    if (groups[0].length === 0 || groups[1].length === 0) {
      const average = averageColor(
        colors,
        colors.map((_, index) => index),
      )
      return { char: "\u2800", fg: average, bg: average }
    }
    centers = [averageColor(colors, groups[0]), averageColor(colors, groups[1])]
  }

  const foregroundGroup = groups[0].length <= groups[1].length ? 0 : 1
  const backgroundGroup = foregroundGroup === 0 ? 1 : 0
  let mask = 0
  for (const index of groups[foregroundGroup]) {
    const x = index % 2
    const y = Math.floor(index / 2)
    mask |= BRAILLE_BITS[y]?.[x] ?? 0
  }
  return {
    char: String.fromCharCode(0x2800 + mask),
    fg: centers[foregroundGroup],
    bg: centers[backgroundGroup],
  }
}

/**
 * Encode a {@link PixelImage} using Unicode Braille characters. Each cell
 * clusters a 2×4 pixel block into foreground/background colors, then uses
 * the Braille dot mask to preserve edges and thin details.
 */
export function encodeBraille(image: PixelImage, options: BrailleOptions): string {
  const target = resize(image, options.columns * 2, options.rows * 4)
  const lines: string[] = []
  for (let y = 0; y < target.height; y += 4) {
    let line = ""
    for (let x = 0; x < target.width; x += 2) {
      const colors: RgbaColor[] = []
      for (let dy = 0; dy < 4; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const i = ((y + dy) * target.width + (x + dx)) * 4
          const a = (target.data[i + 3] ?? 0) / 255
          colors.push([
            Math.round((target.data[i] ?? 0) * a),
            Math.round((target.data[i + 1] ?? 0) * a),
            Math.round((target.data[i + 2] ?? 0) * a),
            Math.round(a * 255),
          ])
        }
      }
      const cell = brailleCell(colors)
      line += `\x1b[38;2;${cell.fg[0]};${cell.fg[1]};${cell.fg[2]}m\x1b[48;2;${cell.bg[0]};${cell.bg[1]};${cell.bg[2]}m${cell.char}\x1b[0m`
    }
    lines.push(line)
  }
  return lines.join("\n")
}

export interface AsciiBlocksOptions {
  readonly columns: number
  readonly rows: number
}

/**
 * Last-resort fallback: ASCII block characters only. Works in any terminal,
 * even when SGR/colour is disabled.
 */
export function encodeAsciiBlocks(image: PixelImage, options: AsciiBlocksOptions): string {
  const target = resize(image, options.columns, options.rows)
  const lines: string[] = []
  const RAMP = " .:-=+*#%@"
  for (let y = 0; y < target.height; y++) {
    let line = ""
    for (let x = 0; x < target.width; x++) {
      const i = (y * target.width + x) * 4
      const a = (target.data[i + 3] ?? 0) / 255
      const r = (target.data[i] ?? 0) * a
      const g = (target.data[i + 1] ?? 0) * a
      const b = (target.data[i + 2] ?? 0) * a
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
      const idx = Math.min(RAMP.length - 1, Math.floor((lum / 255) * RAMP.length))
      line += RAMP[idx]
    }
    lines.push(line)
  }
  return lines.join("\n")
}

export { base64FromBytes, rgbaToPng, rgbaToRgb, crop, resize }
