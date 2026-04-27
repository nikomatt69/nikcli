import { describe, expect, it } from "bun:test"
import { chunkText } from "@/rag/chunk"

describe("chunkText", () => {
  it("returns one chunk for empty text", () => {
    const { chunks, truncated } = chunkText({
      file: "a.ts",
      text: "",
      chunkLines: 10,
      maxChunks: 100,
    })
    expect(truncated).toBe(false)
    expect(chunks).toHaveLength(1)
    expect(chunks[0]?.start).toBe(1)
    expect(chunks[0]?.end).toBe(1)
    expect(chunks[0]?.text).toBe("")
    expect(chunks[0]?.file).toBe("a.ts")
    expect(chunks[0]?.id.startsWith("chunk_")).toBe(true)
  })

  it("splits on line boundaries and uses 1-based start lines", () => {
    const text = ["line1", "line2", "line3", "line4"].join("\n")
    const { chunks, truncated } = chunkText({
      file: "f.txt",
      text,
      chunkLines: 2,
      maxChunks: 10,
    })
    expect(truncated).toBe(false)
    expect(chunks).toHaveLength(2)
    expect(chunks[0]).toMatchObject({ start: 1, end: 2, text: "line1\nline2" })
    expect(chunks[1]).toMatchObject({ start: 3, end: 4, text: "line3\nline4" })
  })

  it("sets truncated when maxChunks caps output", () => {
    const text = Array.from({ length: 20 }, (_, i) => `L${i}`).join("\n")
    const { chunks, truncated } = chunkText({
      file: "big.txt",
      text,
      chunkLines: 1,
      maxChunks: 3,
    })
    expect(chunks).toHaveLength(3)
    expect(truncated).toBe(true)
    expect(chunks[0]?.text).toBe("L0")
    expect(chunks[2]?.text).toBe("L2")
  })

  it("is stable for the same file and range", () => {
    const text = "a\nb\n"
    const a = chunkText({ file: "same.ts", text, chunkLines: 1, maxChunks: 10 })
    const b = chunkText({ file: "same.ts", text, chunkLines: 1, maxChunks: 10 })
    expect(a.chunks.map((c) => c.id)).toEqual(b.chunks.map((c) => c.id))
  })
})
