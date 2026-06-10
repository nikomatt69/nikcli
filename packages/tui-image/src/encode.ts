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
import { crop, resize, type PixelImage } from "./pixels";

const ESC = "\x1b";
const ST = "\x1b\\";

/** Always emits the seven-bit ST (`ESC \`), which every modern terminal accepts. */
function apc(...parts: string[]): string {
  return `${ESC}_G${parts.join(";")}${ST}`;
}

/** iTerm2 inline images use a different framing: `OSC 1337 ; … ST`. */
function osc(...parts: string[]): string {
  return `${ESC}]1337;${parts.join(";")}${ST}`;
}

function base64FromBytes(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(
      bytes.buffer,
      bytes.byteOffset,
      bytes.byteLength,
    ).toString("base64");
  }
  let binary = "";
  for (let i = 0; i < bytes.length; i++)
    binary += String.fromCharCode(bytes[i] ?? 0);
  // btoa is available in both browsers and modern Bun/Node.
  return btoa(binary);
}

/** Convert RGBA buffer to a tightly-packed RGB buffer (drops alpha). */
function rgbaToRgb(image: PixelImage): Uint8Array {
  const out = new Uint8Array(image.width * image.height * 3);
  for (let i = 0, j = 0; i < image.data.length; i += 4, j += 3) {
    const a = (image.data[i + 3] ?? 0) / 255;
    out[j] = Math.round((image.data[i] ?? 0) * a);
    out[j + 1] = Math.round((image.data[i + 1] ?? 0) * a);
    out[j + 2] = Math.round((image.data[i + 2] ?? 0) * a);
  }
  return out;
}

/** Convert RGBA buffer to PNG bytes. Implemented as a small dependency-free writer. */
function rgbaToPng(image: PixelImage): Uint8Array {
  return new U_PngEncoder(image.width, image.height).encode(image.data);
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
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++)
        c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    return table;
  })();

  constructor(
    private readonly width: number,
    private readonly height: number,
  ) {}

  private static crc32(bytes: Uint8Array): number {
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) {
      crc =
        U_PngEncoder.CRC_TABLE[(crc ^ (bytes[i] ?? 0)) & 0xff]! ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  private chunk(type: string, data: Uint8Array): Uint8Array {
    const out = new Uint8Array(4 + 4 + data.length + 4);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, data.length);
    out.set(new TextEncoder().encode(type), 4);
    out.set(data, 8);
    const crcInput = new Uint8Array(4 + data.length);
    crcInput.set(out.subarray(4, 8 + data.length), 0);
    dv.setUint32(8 + data.length, U_PngEncoder.crc32(crcInput));
    return out;
  }

  private ihdr(): Uint8Array {
    const buf = new Uint8Array(13);
    const dv = new DataView(buf.buffer);
    dv.setUint32(0, this.width);
    dv.setUint32(4, this.height);
    buf[8] = 8; // bit depth
    buf[9] = 6; // color type: RGBA
    buf[10] = 0;
    buf[11] = 0;
    buf[12] = 0;
    return this.chunk("IHDR", buf);
  }

  private idat(rgba: Uint8ClampedArray): Uint8Array {
    // Filter byte (0 = None) precedes every scanline.
    const scanline = this.width * 4;
    const raw = new Uint8Array((scanline + 1) * this.height);
    for (let y = 0; y < this.height; y++) {
      raw[y * (scanline + 1)] = 0;
      raw.set(
        rgba.subarray(y * scanline, y * scanline + scanline),
        y * (scanline + 1) + 1,
      );
    }
    return this.chunk("IDAT", zlibStore(raw));
  }

  private iend(): Uint8Array {
    return this.chunk("IEND", new Uint8Array(0));
  }

  encode(rgba: Uint8ClampedArray): Uint8Array {
    const signature = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    const total =
      8 + this.ihdr().length + this.idat(rgba).length + this.iend().length;
    const out = new Uint8Array(total);
    let offset = 0;
    const write = (bytes: Uint8Array) => {
      out.set(bytes, offset);
      offset += bytes.length;
    };
    write(signature);
    write(this.ihdr());
    write(this.idat(rgba));
    write(this.iend());
    return out;
  }
}

/**
 * Wrap raw bytes in a single-member zlib stream using the `Stored` block
 * algorithm. This produces slightly larger output than deflate but requires
 * zero dependencies, which matters because the encoder runs in the browser
 * bundle and in the tiny TUI renderer thread.
 */
function zlibStore(input: Uint8Array): Uint8Array {
  const out: number[] = [];
  // zlib header
  out.push(0x78, 0x01);

  const maxBlock = 0xffff;
  for (let i = 0; i < input.length; i += maxBlock) {
    const remaining = Math.min(maxBlock, input.length - i);
    const last = i + remaining >= input.length ? 1 : 0;
    // BTYPE=00, BFINAL=last → header byte is just `last`.
    out.push(last);
    out.push(remaining & 0xff, (remaining >>> 8) & 0xff);
    const complement = ~remaining & 0xffff;
    out.push(complement & 0xff, (complement >>> 8) & 0xff);
    for (let j = 0; j < remaining; j++) out.push(input[i + j] ?? 0);
  }
  // adler32
  const adler = adler32(input);
  out.push(
    (adler >>> 24) & 0xff,
    (adler >>> 16) & 0xff,
    (adler >>> 8) & 0xff,
    adler & 0xff,
  );
  return new Uint8Array(out);
}

function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < bytes.length; i++) {
    a = (a + (bytes[i] ?? 0)) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

export interface KittyOptions {
  /** Source image id (defaults to a stable hash of the pixels). */
  readonly id?: number;
  /** Image width in cells. Defaults to `image.width`. */
  readonly columns?: number;
  /** Image height in cells. Defaults to `image.height`. */
  readonly rows?: number;
  /** When `true`, the image is transmitted as PNG instead of raw RGBA. */
  readonly format?: "png" | "rgba";
  /** Suppress the placeholder character at the cursor position. */
  readonly quiet?: boolean;
  /**
   * When `true`, the image is sent as a fresh `a=T` (transmit+display)
   * command. The default of `false` uses `a=t` (transmit only) and follows
   * up with a separate `a=p` (put) command, which is the pattern OpenTUI uses
   * to update the same image in place.
   */
  readonly fresh?: boolean;
}

/**
 * Encode a {@link PixelImage} using the Kitty Graphics Protocol. The output
 * is a single string ready to write to stdout.
 *
 * Reference: <https://sw.kovidgoyal.net/kitty/graphics-protocol/>
 */
export function encodeKitty(
  image: PixelImage,
  options: KittyOptions = {},
): string {
  const columns = Math.max(1, options.columns ?? image.width);
  const rows = Math.max(1, options.rows ?? image.height);
  const id = options.id ?? 1;
  const fresh = options.fresh ?? false;
  const quiet = options.quiet ? "q=1" : "q=2";

  // Kitty caps a single transmission at 4096 bytes of base64; we chunk to be
  // safe. Empirically small preview images fit in one chunk, but we always
  // go through the chunker so the encoder behaves identically for big inputs.
  const chunks: string[] = [];
  if (options.format === "rgba") {
    const rgb = rgbaToRgb(image);
    const payload = base64FromBytes(rgb);
    const chunkSize = 4096;
    for (let i = 0; i < payload.length; i += chunkSize) {
      const part = payload.slice(i, i + chunkSize);
      const more = i + chunkSize < payload.length ? 1 : 0;
      const action = i === 0 ? (fresh ? "a=T" : "a=t") : `m=${more}`;
      chunks.push(
        apc(
          `${action}`,
          `f=24`,
          `s=${image.width}`,
          `v=${image.height}`,
          quiet,
          `i=${id}`,
          part,
        ),
      );
    }
    chunks.push(apc("a=p", `p=1`, `i=${id}`, `c=${columns}`, `r=${rows}`));
    return chunks.join("");
  }

  const png = rgbaToPng(image);
  const payload = base64FromBytes(png);
  const chunkSize = 4096;
  for (let i = 0; i < payload.length; i += chunkSize) {
    const part = payload.slice(i, i + chunkSize);
    const more = i + chunkSize < payload.length ? 1 : 0;
    const action = i === 0 ? (fresh ? "a=T" : "a=t") : `m=${more}`;
    chunks.push(
      apc(
        `${action}`,
        `f=100`,
        `s=${image.width}`,
        `v=${image.height}`,
        quiet,
        `i=${id}`,
        part,
      ),
    );
  }
  chunks.push(apc("a=p", `p=1`, `i=${id}`, `c=${columns}`, `r=${rows}`));
  return chunks.join("");
}

export interface Iterm2Options {
  readonly width?: number | string;
  readonly height?: number | string;
  /** When `true`, the image is `inline=1` (preserves aspect ratio). */
  readonly preserveAspectRatio?: boolean;
}

/**
 * Encode a {@link PixelImage} using the iTerm2 inline images protocol. The
 * output is a single string ready to write to stdout.
 *
 * Reference: <https://iterm2.com/documentation-images.html>
 */
export function encodeIterm2(
  image: PixelImage,
  options: Iterm2Options = {},
): string {
  const png = rgbaToPng(image);
  const payload = base64FromBytes(png);
  const width = options.width ?? image.width;
  const height = options.height ?? image.height;
  const preserve = options.preserveAspectRatio !== false ? "1" : "0";
  return osc(
    `file=${png.byteLength};width=${width};height=${height};preserveAspectRatio=${preserve};inline=1`,
    payload,
  );
}

/**
 * Sixel palette quantiser. We don't ship a full median-cut implementation;
 * for previews a fixed 256-colour palette ordered by perceptual distance is
 * perfectly adequate. The palette below is the standard xterm 256-colour
 * palette.
 */
const SIXEL_PALETTE: ReadonlyArray<readonly [number, number, number]> = (() => {
  const out: [number, number, number][] = [];
  for (let r = 0; r < 6; r++) {
    for (let g = 0; g < 6; g++) {
      for (let b = 0; b < 6; b++) {
        out.push([(r * 255) / 5, (g * 255) / 5, (b * 255) / 5]);
      }
    }
  }
  for (let g = 0; g < 24; g++)
    out.push([(g * 255) / 23, (g * 255) / 23, (g * 255) / 23]);
  return out;
})();

function nearestPaletteIndex(r: number, g: number, b: number): number {
  let best = 0;
  let bestDist = Number.POSITIVE_INFINITY;
  for (let i = 0; i < SIXEL_PALETTE.length; i++) {
    const entry = SIXEL_PALETTE[i]!;
    const dr = entry[0] - r;
    const dg = entry[1] - g;
    const db = entry[2] - b;
    const dist = dr * dr + dg * dg + db * db;
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  return best;
}

/**
 * Encode a {@link PixelImage} as DEC Sixel. Returns raw bytes ready to write
 * to stdout. Each output row corresponds to 6 source pixels.
 *
 * Reference: <https://vt100.net/docs/vt3xx-gp/chapter14.html>
 */
export function encodeSixel(image: PixelImage): Uint8Array {
  // Initialise a 256-colour palette; we register only the colours we use.
  const usedPalette = new Map<number, number>(); // palette index → sixel register
  let nextRegister = 0;
  const parts: number[] = [];
  const push = (s: string) => {
    for (let i = 0; i < s.length; i++) parts.push(s.charCodeAt(i) & 0x7f);
  };

  push("\x1bPq"); // DECSIXEL introducer
  push('"1;1;0;0;0'); // raster attributes: 1:1 pixel aspect, 0×0 image size hints
  // We track the per-row run-length encoding state across columns.
  let lastRegister = -1;
  for (let y = 0; y < image.height; y += 6) {
    let runStart = 0;
    let runRegister = -1;
    let runChar = 0;
    const flushRun = (endX: number) => {
      if (runRegister === -1 || endX <= runStart) return;
      const length = endX - runStart;
      if (length > 1) push(`!${length}`);
      if (runRegister !== lastRegister) {
        push(`#${runRegister}`);
        lastRegister = runRegister;
      }
      push(String.fromCharCode(0x3f + runChar));
    };
    for (let x = 0; x < image.width; x++) {
      let band = 0;
      for (let dy = 0; dy < 6; dy++) {
        const yy = y + dy;
        if (yy >= image.height) break;
        const i = (yy * image.width + x) * 4;
        const a = (image.data[i + 3] ?? 0) / 255;
        if (a < 0.5) continue;
        const r = (image.data[i] ?? 0) * a;
        const g = (image.data[i + 1] ?? 0) * a;
        const b = (image.data[i + 2] ?? 0) * a;
        const idx = nearestPaletteIndex(r, g, b);
        const register = usedPalette.get(idx) ?? -1;
        if (register === -1 && nextRegister < 256) {
          usedPalette.set(idx, nextRegister);
          const entry = SIXEL_PALETTE[idx]!;
          push(
            `#${nextRegister};2;${Math.round(entry[0])};${Math.round(entry[1])};${Math.round(entry[2])}`,
          );
          runRegister = nextRegister;
          nextRegister += 1;
        } else {
          runRegister = register;
        }
        if (runRegister === -1) continue;
        band |= 1 << dy;
      }
      if (band === runChar && runRegister !== -1) continue;
      flushRun(x);
      runStart = x;
      runChar = band;
      if (band === 0) {
        runRegister = -1;
        continue;
      }
      const idx = band >= 0x20 ? -1 : -1;
      if (idx === -1) runRegister = runRegister;
    }
    flushRun(image.width);
    push("$"); // carriage return (move to start of next band)
    push("-"); // line feed (advance to next sixel band)
    lastRegister = -1;
  }
  push("\x1b\\"); // ST
  return new Uint8Array(parts);
}

export interface HalfBlockOptions {
  /** Width in terminal cells. */
  readonly columns: number;
  /** Height in terminal cells. */
  readonly rows: number;
  /** When `true`, emit 24-bit color escape sequences (default). */
  readonly truecolor?: boolean;
}

/**
 * Encode a {@link PixelImage} using Unicode half-block characters. Each cell
 * encodes two vertical pixels (top + bottom). The output preserves aspect
 * ratio because terminal cells are roughly twice as tall as they are wide.
 */
export function encodeHalfblock(
  image: PixelImage,
  options: HalfBlockOptions,
): string {
  const { columns, rows } = options;
  const truecolor = options.truecolor !== false;
  const target = resize(image, columns, Math.max(1, rows * 2));
  const lines: string[] = [];
  const reset = truecolor ? "\x1b[0m" : "";
  for (let y = 0; y < target.height; y += 2) {
    let line = "";
    for (let x = 0; x < target.width; x++) {
      const top = sample(target, x, y);
      const bottom = sample(target, x, y + 1);
      if (truecolor) {
        line += `\x1b[38;2;${top[0]};${top[1]};${top[2]}m\x1b[48;2;${bottom[0]};${bottom[1]};${bottom[2]}m\u2580`;
      } else {
        line += "▀";
      }
    }
    lines.push(line + reset);
  }
  return lines.join("\n");
}

function sample(
  image: PixelImage,
  x: number,
  y: number,
): [number, number, number] {
  const yy = Math.max(0, Math.min(image.height - 1, y));
  const xx = Math.max(0, Math.min(image.width - 1, x));
  const i = (yy * image.width + xx) * 4;
  const a = (image.data[i + 3] ?? 0) / 255;
  return [
    Math.round((image.data[i] ?? 0) * a),
    Math.round((image.data[i + 1] ?? 0) * a),
    Math.round((image.data[i + 2] ?? 0) * a),
  ];
}

export interface BrailleOptions {
  readonly columns: number;
  readonly rows: number;
}

const BRAILLE_BITS: readonly (readonly [number, number])[] = [
  [0x01, 0x08],
  [0x02, 0x10],
  [0x04, 0x20],
  [0x40, 0x80],
];

/**
 * Encode a {@link PixelImage} using Unicode Braille characters, similar to
 * the existing `image-preview.tsx` in nikcli. Each cell covers a 2×4 block
 * of source pixels.
 */
export function encodeBraille(
  image: PixelImage,
  options: BrailleOptions,
): string {
  const target = resize(image, options.columns * 2, options.rows * 4);
  const lines: string[] = [];
  for (let y = 0; y < target.height; y += 4) {
    let line = "";
    for (let x = 0; x < target.width; x += 2) {
      let mask = 0;
      let rTotal = 0;
      let gTotal = 0;
      let bTotal = 0;
      let aTotal = 0;
      let count = 0;
      let maxLuminance = 0;
      let minLuminance = 255;
      let minColor: [number, number, number] = [0, 0, 0];
      let maxColor: [number, number, number] = [0, 0, 0];
      for (let dy = 0; dy < 4; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const i = ((y + dy) * target.width + (x + dx)) * 4;
          const a = (target.data[i + 3] ?? 0) / 255;
          const r = (target.data[i] ?? 0) * a;
          const g = (target.data[i + 1] ?? 0) * a;
          const b = (target.data[i + 2] ?? 0) * a;
          const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
          if (lum < minLuminance) {
            minLuminance = lum;
            minColor = [Math.round(r), Math.round(g), Math.round(b)];
          }
          if (lum > maxLuminance) {
            maxLuminance = lum;
            maxColor = [Math.round(r), Math.round(g), Math.round(b)];
          }
          rTotal += r;
          gTotal += g;
          bTotal += b;
          aTotal += a;
          count += 1;
          mask |= BRAILLE_BITS[dy]?.[dx] ?? 0;
        }
      }
      const contrast = maxLuminance - minLuminance;
      const avg: [number, number, number] = [
        Math.round(rTotal / count),
        Math.round(gTotal / count),
        Math.round(bTotal / count),
      ];
      let fg: [number, number, number] = maxColor;
      let bg: [number, number, number] = contrast < 24 ? avg : minColor;
      if (avg[0] === avg[1] && avg[1] === avg[2] && avg[2] < 16) {
        fg = maxColor;
        bg = [0, 0, 0];
        mask = 0;
      }
      line += `\x1b[38;2;${fg[0]};${fg[1]};${fg[2]}m\x1b[48;2;${bg[0]};${bg[1]};${bg[2]}m${String.fromCharCode(0x2800 + mask)}\x1b[0m`;
    }
    lines.push(line);
  }
  return lines.join("\n");
}

export interface AsciiBlocksOptions {
  readonly columns: number;
  readonly rows: number;
}

/**
 * Last-resort fallback: ASCII block characters only. Works in any terminal,
 * even when SGR/colour is disabled.
 */
export function encodeAsciiBlocks(
  image: PixelImage,
  options: AsciiBlocksOptions,
): string {
  const target = resize(image, options.columns, options.rows);
  const lines: string[] = [];
  const RAMP = " .:-=+*#%@";
  for (let y = 0; y < target.height; y++) {
    let line = "";
    for (let x = 0; x < target.width; x++) {
      const i = (y * target.width + x) * 4;
      const a = (target.data[i + 3] ?? 0) / 255;
      const r = (target.data[i] ?? 0) * a;
      const g = (target.data[i + 1] ?? 0) * a;
      const b = (target.data[i + 2] ?? 0) * a;
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const idx = Math.min(
        RAMP.length - 1,
        Math.floor((lum / 255) * RAMP.length),
      );
      line += RAMP[idx];
    }
    lines.push(line);
  }
  return lines.join("\n");
}

export { base64FromBytes, rgbaToPng, rgbaToRgb, crop, resize };
