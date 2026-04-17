import { describe, expect, test } from "bun:test"
import { linesFromNativeCellBuffer } from "./backend"

function pushCell(bytes: number[], char: string, fg: number, bg: number) {
  const codePoint = char.codePointAt(0) ?? 32
  bytes.push(...new Uint8Array(new Uint32Array([codePoint]).buffer))
  bytes.push(...new Uint8Array(new Uint32Array([fg]).buffer))
  bytes.push(...new Uint8Array(new Uint32Array([bg]).buffer))
}

describe("ANSI backend line packing", () => {
  test("groups adjacent cells with the same colors into a single segment", () => {
    const bytes: number[] = []
    pushCell(bytes, "A", 0xffffff, 0x000000)
    pushCell(bytes, "B", 0xffffff, 0x000000)
    pushCell(bytes, "C", 0x00ff00, 0x000000)

    const lines = linesFromNativeCellBuffer(Uint8Array.from(bytes), 3, 1)

    expect(lines).toEqual([
      {
        segments: [
          { text: "AB", fg: "#ffffff", bg: "#000000" },
          { text: "C", fg: "#00ff00", bg: "#000000" },
        ],
      },
    ])
  })
})
