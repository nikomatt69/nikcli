import { describe, expect, it } from "bun:test"
import {
  KITTY_PLACEHOLDER,
  MAX_PLACEHOLDER_ID,
  ROW_COLUMN_DIACRITICS,
  deleteKittyVirtual,
  encodeKittyVirtual,
  encodeKittyVirtualFile,
  encodeKittyVirtualPng,
  kittyIdColor,
  kittyPlaceholderGrid,
  kittyPlaceholderRow,
  supportsKittyUnicodePlaceholders,
} from "../src/kitty-placeholder"
import type { Capabilities } from "../src/capabilities"
import { Protocol } from "../src/capabilities"
import { createPixelImage } from "../src/pixels"

const ESC = "\x1b"
const ST = "\x1b\\"

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

function kittyCaps(terminal: string | null): Capabilities {
  return {
    best: Protocol.KITTY,
    available: [Protocol.KITTY],
    kitty: true,
    sixel: false,
    iterm2: false,
    terminal,
  }
}

function chunksOf(output: string): { control: string; payload: string }[] {
  const out: { control: string; payload: string }[] = []
  for (const match of output.matchAll(/\x1b_G([^;\x1b]*)(?:;([^\x1b]*))?\x1b\\/g)) {
    out.push({ control: match[1] ?? "", payload: match[2] ?? "" })
  }
  return out
}

describe("rowcolumn diacritics", () => {
  it("matches the official kitty table", () => {
    expect(ROW_COLUMN_DIACRITICS).toHaveLength(297)
    expect(ROW_COLUMN_DIACRITICS.slice(0, 6)).toEqual([0x0305, 0x030d, 0x030e, 0x0310, 0x0312, 0x033d])
    expect(ROW_COLUMN_DIACRITICS.at(-1)).toBe(0x1d244)
  })
})

describe("kittyPlaceholderRow", () => {
  it("emits placeholder + row diacritic + column diacritic per cell", () => {
    const row = kittyPlaceholderRow(1, 3)
    const codepoints = [...row].map((ch) => ch.codePointAt(0))
    expect(codepoints).toEqual([0x10eeee, 0x030d, 0x0305, 0x10eeee, 0x030d, 0x030d, 0x10eeee, 0x030d, 0x030e])
    expect(row.startsWith(KITTY_PLACEHOLDER)).toBe(true)
  })

  it("builds a full grid", () => {
    const grid = kittyPlaceholderGrid(4, 2)
    expect(grid).toHaveLength(2)
    for (const row of grid) expect([...row]).toHaveLength(4 * 3)
  })
})

describe("encodeKittyVirtual", () => {
  it("emits a single drawless chunk for small images", () => {
    const image = createPixelImage(2, 2, [255, 0, 0, 255])
    const output = encodeKittyVirtual(image, { id: 42, columns: 4, rows: 2 })
    const chunks = chunksOf(output)
    expect(chunks).toHaveLength(1)
    expect(chunks[0]!.control).toBe("a=T,U=1,q=2,f=100,i=42,c=4,r=2")
    const bytes = Uint8Array.fromBase64(chunks[0]!.payload)
    expect([...bytes.subarray(0, 8)]).toEqual(PNG_SIGNATURE)
  })

  it("chunks large payloads per spec: head+m=1 first, bare m after", () => {
    // Random pixels defeat compression, forcing the chunked path.
    const image = createPixelImage(96, 96)
    crypto.getRandomValues(image.data)
    const output = encodeKittyVirtual(image, { id: 7, columns: 10, rows: 5 })
    const chunks = chunksOf(output)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks[0]!.control).toBe("a=T,U=1,q=2,f=100,i=7,c=10,r=5,m=1")
    for (const chunk of chunks.slice(1, -1)) expect(chunk.control).toBe("m=1")
    expect(chunks.at(-1)!.control).toBe("m=0")
    for (const chunk of chunks) expect(chunk.payload.length).toBeLessThanOrEqual(4096)
    const bytes = Uint8Array.fromBase64(chunks.map((c) => c.payload).join(""))
    expect([...bytes.subarray(0, 8)]).toEqual(PNG_SIGNATURE)
  })

  it("rejects out-of-range ids", () => {
    const image = createPixelImage(1, 1)
    expect(() => encodeKittyVirtual(image, { id: 0, columns: 1, rows: 1 })).toThrow(RangeError)
    expect(() => encodeKittyVirtual(image, { id: MAX_PLACEHOLDER_ID + 1, columns: 1, rows: 1 })).toThrow(RangeError)
  })
})

describe("encodeKittyVirtualPng", () => {
  it("transmits the given bytes verbatim", () => {
    const image = createPixelImage(3, 3, [0, 128, 255, 255])
    const png = Uint8Array.fromBase64(chunksOf(encodeKittyVirtual(image, { id: 1, columns: 1, rows: 1 }))[0]!.payload)

    const output = encodeKittyVirtualPng(png, { id: 9, columns: 6, rows: 3 })
    const chunks = chunksOf(output)
    expect(chunks[0]!.control).toBe("a=T,U=1,q=2,f=100,i=9,c=6,r=3")
    expect([...Uint8Array.fromBase64(chunks[0]!.payload)]).toEqual([...png])
  })

  it("produces the same command as the PixelImage path for the same pixels", () => {
    const image = createPixelImage(4, 4, [10, 20, 30, 255])
    const viaImage = encodeKittyVirtual(image, { id: 5, columns: 2, rows: 1 })
    const png = Uint8Array.fromBase64(chunksOf(viaImage)[0]!.payload)
    expect(encodeKittyVirtualPng(png, { id: 5, columns: 2, rows: 1 })).toBe(viaImage)
  })

  it("chunks large payloads per spec", () => {
    const png = new Uint8Array(8192)
    crypto.getRandomValues(png)
    const chunks = chunksOf(encodeKittyVirtualPng(png, { id: 3, columns: 8, rows: 4 }))
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks[0]!.control).toBe("a=T,U=1,q=2,f=100,i=3,c=8,r=4,m=1")
    expect(chunks.at(-1)!.control).toBe("m=0")
    expect([...Uint8Array.fromBase64(chunks.map((c) => c.payload).join(""))]).toEqual([...png])
  })

  it("rejects out-of-range ids", () => {
    expect(() => encodeKittyVirtualPng(new Uint8Array(4), { id: 0, columns: 1, rows: 1 })).toThrow(RangeError)
  })
})

describe("encodeKittyVirtualFile", () => {
  it("sends the path, not the pixels", () => {
    const path = "/tmp/nikcli-screencast-abc/frame-2.png"
    const chunks = chunksOf(encodeKittyVirtualFile(path, { id: 12, columns: 40, rows: 20 }))
    expect(chunks).toHaveLength(1)
    expect(chunks[0]!.control).toBe("a=T,U=1,q=2,f=100,t=t,i=12,c=40,r=20")
    expect(new TextDecoder().decode(Uint8Array.fromBase64(chunks[0]!.payload))).toBe(path)
  })

  it("stays a fixed size regardless of how big the image is", () => {
    const short = encodeKittyVirtualFile("/tmp/a.png", { id: 1, columns: 1, rows: 1 })
    const long = encodeKittyVirtualFile("/tmp/a.png", { id: 1, columns: 200, rows: 100 })
    expect(short.length).toBeLessThan(120)
    expect(long.length).toBeLessThan(130)
  })

  it("rejects out-of-range ids", () => {
    expect(() => encodeKittyVirtualFile("/tmp/a.png", { id: 0, columns: 1, rows: 1 })).toThrow(RangeError)
  })
})

describe("kittyIdColor", () => {
  it("encodes the id in the 24-bit foreground", () => {
    expect(kittyIdColor(0xabcdef)).toEqual({ r: 0xab, g: 0xcd, b: 0xef })
    expect(kittyIdColor(1)).toEqual({ r: 0, g: 0, b: 1 })
  })
})

describe("deleteKittyVirtual", () => {
  it("frees the image and its placements", () => {
    expect(deleteKittyVirtual(9)).toBe(`${ESC}_Ga=d,d=I,i=9,q=2${ST}`)
  })
})

describe("supportsKittyUnicodePlaceholders", () => {
  it("is on for kitty and ghostty, off for other kitty-protocol terminals", () => {
    expect(supportsKittyUnicodePlaceholders(kittyCaps("xterm-kitty"), {})).toBe(true)
    expect(supportsKittyUnicodePlaceholders(kittyCaps("ghostty"), {})).toBe(true)
    expect(supportsKittyUnicodePlaceholders(kittyCaps("WezTerm"), {})).toBe(false)
    expect(supportsKittyUnicodePlaceholders({ ...kittyCaps("kitty"), kitty: false }, {})).toBe(false)
  })

  it("detects the host via environment variables", () => {
    expect(supportsKittyUnicodePlaceholders(kittyCaps(null), { KITTY_WINDOW_ID: "1" })).toBe(true)
    expect(supportsKittyUnicodePlaceholders(kittyCaps(null), { GHOSTTY_RESOURCES_DIR: "/x" })).toBe(true)
    expect(supportsKittyUnicodePlaceholders(kittyCaps(null), { TERM: "xterm-ghostty" })).toBe(true)
    expect(supportsKittyUnicodePlaceholders(kittyCaps(null), {})).toBe(false)
  })

  it("is on inside a herdr pane", () => {
    expect(supportsKittyUnicodePlaceholders(kittyCaps("herdr"), { HERDR_PANE_ID: "w1Y:p6" })).toBe(true)
    expect(supportsKittyUnicodePlaceholders(kittyCaps("herdr"), { HERDR_ENV: "1" })).toBe(true)
  })

  it("honours the explicit override", () => {
    expect(supportsKittyUnicodePlaceholders(kittyCaps("kitty"), { NIKCLI_KITTY_PLACEHOLDERS: "0" })).toBe(false)
    expect(supportsKittyUnicodePlaceholders(kittyCaps("WezTerm"), { NIKCLI_KITTY_PLACEHOLDERS: "1" })).toBe(true)
  })
})
