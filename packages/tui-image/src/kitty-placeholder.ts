/**
 * Kitty Unicode placeholders ("virtual placements").
 *
 * The classic Kitty Graphics Protocol draws at the cursor position, which is
 * useless inside a grid TUI: the renderer repaints cells underneath and the
 * cursor is never where the component is. Virtual placements solve this:
 *
 *  1. the image is transmitted once with `a=T,U=1` — nothing is drawn,
 *  2. the TUI renders ordinary text cells made of U+10EEEE followed by two
 *     combining diacritics (row, column) with the image id encoded in the
 *     24-bit foreground color,
 *  3. the terminal composites the image over those cells wherever they end
 *     up — scrolling, partial visibility and repaints all work, because the
 *     placeholders are normal grid characters.
 *
 * Reference: <https://sw.kovidgoyal.net/kitty/graphics-protocol/#unicode-placeholders>
 *
 * Supported by kitty and Ghostty (WezTerm/Warp implement the classic
 * protocol but not, as of early 2026, Unicode placeholders) — see
 * {@link supportsKittyUnicodePlaceholders}.
 */
import type { PixelImage } from "./pixels"
import { base64FromBytes, rgbaToPng } from "./encode"
import type { Capabilities } from "./capabilities"

const ESC = "\x1b"
const ST = "\x1b\\"

/** The placeholder base character (U+10EEEE). */
export const KITTY_PLACEHOLDER = "\u{10EEEE}"

/**
 * The official row/column diacritics table from the kitty source
 * (`gen/rowcolumn-diacritics.txt`) — 297 combining characters of combining
 * class 230 used to address rows and columns inside a placeholder rectangle.
 * Index N addresses row/column N (0-based).
 */
// prettier-ignore
export const ROW_COLUMN_DIACRITICS: readonly number[] = [
  0x0305, 0x030D, 0x030E, 0x0310, 0x0312, 0x033D, 0x033E, 0x033F, 0x0346, 0x034A, 0x034B, 0x034C,
  0x0350, 0x0351, 0x0352, 0x0357, 0x035B, 0x0363, 0x0364, 0x0365, 0x0366, 0x0367, 0x0368, 0x0369,
  0x036A, 0x036B, 0x036C, 0x036D, 0x036E, 0x036F, 0x0483, 0x0484, 0x0485, 0x0486, 0x0487, 0x0592,
  0x0593, 0x0594, 0x0595, 0x0597, 0x0598, 0x0599, 0x059C, 0x059D, 0x059E, 0x059F, 0x05A0, 0x05A1,
  0x05A8, 0x05A9, 0x05AB, 0x05AC, 0x05AF, 0x05C4, 0x0610, 0x0611, 0x0612, 0x0613, 0x0614, 0x0615,
  0x0616, 0x0617, 0x0657, 0x0658, 0x0659, 0x065A, 0x065B, 0x065D, 0x065E, 0x06D6, 0x06D7, 0x06D8,
  0x06D9, 0x06DA, 0x06DB, 0x06DC, 0x06DF, 0x06E0, 0x06E1, 0x06E2, 0x06E4, 0x06E7, 0x06E8, 0x06EB,
  0x06EC, 0x0730, 0x0732, 0x0733, 0x0735, 0x0736, 0x073A, 0x073D, 0x073F, 0x0740, 0x0741, 0x0743,
  0x0745, 0x0747, 0x0749, 0x074A, 0x07EB, 0x07EC, 0x07ED, 0x07EE, 0x07EF, 0x07F0, 0x07F1, 0x07F3,
  0x0816, 0x0817, 0x0818, 0x0819, 0x081B, 0x081C, 0x081D, 0x081E, 0x081F, 0x0820, 0x0821, 0x0822,
  0x0823, 0x0825, 0x0826, 0x0827, 0x0829, 0x082A, 0x082B, 0x082C, 0x082D, 0x0951, 0x0953, 0x0954,
  0x0F82, 0x0F83, 0x0F86, 0x0F87, 0x135D, 0x135E, 0x135F, 0x17DD, 0x193A, 0x1A17, 0x1A75, 0x1A76,
  0x1A77, 0x1A78, 0x1A79, 0x1A7A, 0x1A7B, 0x1A7C, 0x1B6B, 0x1B6D, 0x1B6E, 0x1B6F, 0x1B70, 0x1B71,
  0x1B72, 0x1B73, 0x1CD0, 0x1CD1, 0x1CD2, 0x1CDA, 0x1CDB, 0x1CE0, 0x1DC0, 0x1DC1, 0x1DC3, 0x1DC4,
  0x1DC5, 0x1DC6, 0x1DC7, 0x1DC8, 0x1DC9, 0x1DCB, 0x1DCC, 0x1DD1, 0x1DD2, 0x1DD3, 0x1DD4, 0x1DD5,
  0x1DD6, 0x1DD7, 0x1DD8, 0x1DD9, 0x1DDA, 0x1DDB, 0x1DDC, 0x1DDD, 0x1DDE, 0x1DDF, 0x1DE0, 0x1DE1,
  0x1DE2, 0x1DE3, 0x1DE4, 0x1DE5, 0x1DE6, 0x1DFE, 0x20D0, 0x20D1, 0x20D4, 0x20D5, 0x20D6, 0x20D7,
  0x20DB, 0x20DC, 0x20E1, 0x20E7, 0x20E9, 0x20F0, 0x2CEF, 0x2CF0, 0x2CF1, 0x2DE0, 0x2DE1, 0x2DE2,
  0x2DE3, 0x2DE4, 0x2DE5, 0x2DE6, 0x2DE7, 0x2DE8, 0x2DE9, 0x2DEA, 0x2DEB, 0x2DEC, 0x2DED, 0x2DEE,
  0x2DEF, 0x2DF0, 0x2DF1, 0x2DF2, 0x2DF3, 0x2DF4, 0x2DF5, 0x2DF6, 0x2DF7, 0x2DF8, 0x2DF9, 0x2DFA,
  0x2DFB, 0x2DFC, 0x2DFD, 0x2DFE, 0x2DFF, 0xA66F, 0xA67C, 0xA67D, 0xA6F0, 0xA6F1, 0xA8E0, 0xA8E1,
  0xA8E2, 0xA8E3, 0xA8E4, 0xA8E5, 0xA8E6, 0xA8E7, 0xA8E8, 0xA8E9, 0xA8EA, 0xA8EB, 0xA8EC, 0xA8ED,
  0xA8EE, 0xA8EF, 0xA8F0, 0xA8F1, 0xAAB0, 0xAAB2, 0xAAB3, 0xAAB7, 0xAAB8, 0xAABE, 0xAABF, 0xAAC1,
  0xFE20, 0xFE21, 0xFE22, 0xFE23, 0xFE24, 0xFE25, 0xFE26, 0x10A0F, 0x10A38, 0x1D185, 0x1D186, 0x1D187,
  0x1D188, 0x1D189, 0x1D1AA, 0x1D1AB, 0x1D1AC, 0x1D1AD, 0x1D242, 0x1D243, 0x1D244, 
];

/** Maximum addressable rows/columns for a single virtual placement. */
export const MAX_PLACEHOLDER_DIMENSION = ROW_COLUMN_DIACRITICS.length

/** Largest image id that fits in the 24-bit foreground color. */
export const MAX_PLACEHOLDER_ID = 0xffffff

/**
 * Whether the terminal composites Unicode placeholders. Deliberately
 * narrower than {@link Capabilities.kitty}: WezTerm, Warp and Konsole speak
 * the classic protocol but do not implement virtual placements.
 */
export function supportsKittyUnicodePlaceholders(
  capabilities: Capabilities,
  env: Record<string, string | undefined> = typeof process !== "undefined" ? process.env : {},
): boolean {
  if (!capabilities.kitty) return false
  if (env["NIKCLI_KITTY_PLACEHOLDERS"] === "0") return false
  if (env["NIKCLI_KITTY_PLACEHOLDERS"] === "1") return true
  const terminal = (capabilities.terminal ?? "").toLowerCase()
  if (terminal.includes("kitty") || terminal.includes("ghostty")) return true
  if (env["KITTY_WINDOW_ID"]) return true
  if (env["GHOSTTY_RESOURCES_DIR"] || env["GHOSTTY_BIN_DIR"]) return true
  const termEnv = (env["TERM"] ?? "").toLowerCase()
  return termEnv.includes("kitty") || termEnv.includes("ghostty")
}

export interface KittyVirtualOptions {
  /** Image id, 1..{@link MAX_PLACEHOLDER_ID} (encoded in the fg color). */
  readonly id: number
  /** Placement width in cells. */
  readonly columns: number
  /** Placement height in cells. */
  readonly rows: number
}

function assertId(id: number) {
  if (!Number.isInteger(id) || id < 1 || id > MAX_PLACEHOLDER_ID) {
    throw new RangeError(`kitty virtual placement id must be 1..${MAX_PLACEHOLDER_ID}, got ${id}`)
  }
}

/**
 * Transmit an image as PNG and create a virtual placement for it.
 *
 * The returned string is safe to write to stdout at any time, even from
 * inside an alternate-screen TUI: `U=1` means nothing is drawn at the cursor
 * and `q=2` suppresses every response. The terminal scales the image into
 * the `columns × rows` placeholder rectangle.
 */
export function encodeKittyVirtual(image: PixelImage, options: KittyVirtualOptions): string {
  assertId(options.id)
  const columns = Math.max(1, Math.floor(options.columns))
  const rows = Math.max(1, Math.floor(options.rows))
  const payload = base64FromBytes(compressedPng(image))
  const head = `a=T,U=1,q=2,f=100,i=${options.id},c=${columns},r=${rows}`
  const chunkSize = 4096
  if (payload.length <= chunkSize) {
    return `${ESC}_G${head};${payload}${ST}`
  }
  // Chunked form, per spec: the first chunk carries every key plus `m=1`;
  // continuation chunks carry ONLY `m` (and the payload); the last has `m=0`.
  const chunks: string[] = []
  for (let i = 0; i < payload.length; i += chunkSize) {
    const part = payload.slice(i, i + chunkSize)
    const more = i + chunkSize < payload.length ? 1 : 0
    chunks.push(i === 0 ? `${ESC}_G${head},m=1;${part}${ST}` : `${ESC}_Gm=${more};${part}${ST}`)
  }
  return chunks.join("")
}

/**
 * Delete a virtual image (and all of its placements). Placeholder cells that
 * remain on screen simply stop compositing.
 */
export function deleteKittyVirtual(id: number): string {
  assertId(id)
  return `${ESC}_Ga=d,d=I,i=${id},q=2${ST}`
}

/**
 * The 24-bit foreground color that addresses `id`. Every placeholder cell of
 * the image must be rendered with exactly this foreground.
 */
export function kittyIdColor(id: number): { r: number; g: number; b: number } {
  assertId(id)
  return { r: (id >> 16) & 0xff, g: (id >> 8) & 0xff, b: id & 0xff }
}

/**
 * One row of placeholder cells: each cell is U+10EEEE + row diacritic +
 * column diacritic. Render the string with the {@link kittyIdColor}
 * foreground; the terminal composites the corresponding horizontal slice of
 * the image over it.
 */
export function kittyPlaceholderRow(row: number, columns: number): string {
  if (row < 0 || row >= MAX_PLACEHOLDER_DIMENSION) {
    throw new RangeError(`placeholder row out of range: ${row}`)
  }
  const cols = Math.min(columns, MAX_PLACEHOLDER_DIMENSION)
  const rowMark = String.fromCodePoint(ROW_COLUMN_DIACRITICS[row]!)
  let out = ""
  for (let col = 0; col < cols; col++) {
    out += KITTY_PLACEHOLDER + rowMark + String.fromCodePoint(ROW_COLUMN_DIACRITICS[col]!)
  }
  return out
}

/** All placeholder rows for a `columns × rows` placement. */
export function kittyPlaceholderGrid(columns: number, rows: number): string[] {
  const out: string[] = []
  const r = Math.min(rows, MAX_PLACEHOLDER_DIMENSION)
  for (let row = 0; row < r; row++) out.push(kittyPlaceholderRow(row, columns))
  return out
}

/**
 * PNG bytes for transmission. `rgbaToPng` (encode.ts) deliberately emits
 * uncompressed zlib `Stored` blocks to stay dependency-free; for kitty
 * transmissions the payload crosses the wire, so when a zlib implementation
 * is available (Bun, Node) we recompress the IDAT properly — typically an
 * order of magnitude smaller. Falls back to the stored form in the browser.
 */
function compressedPng(image: PixelImage): Uint8Array {
  const stored = rgbaToPng(image)
  const zlib = loadZlib()
  if (!zlib) return stored
  try {
    // Rebuild the IDAT: filter byte 0 per scanline, then deflate.
    const raw = new Uint8Array(image.height * (1 + image.width * 4))
    for (let y = 0; y < image.height; y++) {
      const target = y * (1 + image.width * 4)
      raw[target] = 0
      raw.set(image.data.subarray(y * image.width * 4, (y + 1) * image.width * 4), target + 1)
    }
    const idat = zlib.deflateSync(raw)
    return rebuildPng(stored, new Uint8Array(idat))
  } catch {
    return stored
  }
}

type Zlib = { deflateSync: (data: Uint8Array) => Uint8Array }

let zlibCache: Zlib | null | undefined

function loadZlib(): Zlib | null {
  if (zlibCache !== undefined) return zlibCache
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("node:zlib") as Zlib
    zlibCache = typeof mod.deflateSync === "function" ? mod : null
  } catch {
    zlibCache = null
  }
  return zlibCache
}

const PNG_SIGNATURE_LENGTH = 8

/** Re-assemble a PNG keeping every non-IDAT chunk, swapping in `idat`. */
function rebuildPng(png: Uint8Array, idat: Uint8Array): Uint8Array {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength)
  const parts: Uint8Array[] = [png.subarray(0, PNG_SIGNATURE_LENGTH)]
  let offset = PNG_SIGNATURE_LENGTH
  let idatWritten = false
  while (offset + 8 <= png.length) {
    const length = view.getUint32(offset)
    const type = String.fromCharCode(png[offset + 4]!, png[offset + 5]!, png[offset + 6]!, png[offset + 7]!)
    const total = 8 + length + 4
    if (type === "IDAT") {
      if (!idatWritten) {
        parts.push(pngChunk("IDAT", idat))
        idatWritten = true
      }
    } else {
      parts.push(png.subarray(offset, offset + total))
    }
    offset += total
  }
  let size = 0
  for (const part of parts) size += part.length
  const out = new Uint8Array(size)
  let cursor = 0
  for (const part of parts) {
    out.set(part, cursor)
    cursor += part.length
  }
  return out
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(4 + 4 + data.length + 4)
  const dv = new DataView(out.buffer)
  dv.setUint32(0, data.length)
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  out.set(data, 8)
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
  return out
}

const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ (bytes[i] ?? 0)) & 0xff]! ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}
