import { describe, expect, it } from "bun:test"
import * as LineAnchor from "@/tool/line-anchor"

const lines = ["const a = 1", "const b = 2", "const c = 3"]
const anchorFor = (index: number) => LineAnchor.parse(LineAnchor.format(index + 1, lines[index]!))!

describe("LineAnchor.format / parse", () => {
  it("round-trips a line into an anchor and back", () => {
    const anchor = anchorFor(1)
    expect(anchor.line).toBe(2)
    expect(anchor.digest).toBe(LineAnchor.digest(lines[1]!))
  })

  it("gives different lines different digests", () => {
    expect(LineAnchor.digest(lines[0]!)).not.toBe(LineAnchor.digest(lines[1]!))
  })

  it("ignores a trailing carriage return so the anchor is platform-independent", () => {
    // The same file read on Windows and on POSIX has to produce the same anchor,
    // or the anchor is addressing the reader rather than the content.
    expect(LineAnchor.digest("const a = 1\r")).toBe(LineAnchor.digest("const a = 1"))
  })

  it("rejects things that are not anchors", () => {
    for (const value of ["", "42", "a3f9c1", "42#", "#a3f9c1", "42#xyz123", "0#a3f9c1", "-1#a3f9c1", "42:a3f9c1"]) {
      expect(LineAnchor.parse(value)).toBeUndefined()
    }
  })

  it("tolerates surrounding whitespace", () => {
    expect(LineAnchor.parse(`  ${LineAnchor.format(1, lines[0]!)}  `)?.line).toBe(1)
  })
})

describe("LineAnchor.resolve", () => {
  it("returns the line when the digest still matches", () => {
    const result = LineAnchor.resolve(anchorFor(2), lines)
    expect(result).toEqual({ ok: true, line: 3, text: "const c = 3" })
  })

  it("refuses when the line changed under it", () => {
    // The whole point: the file moved since it was read, so the anchor now names
    // different content. Editing here would apply the change to whatever took
    // that line's place.
    const stale = anchorFor(1)
    const edited = [...lines]
    edited[1] = "const b = 99"

    const result = LineAnchor.resolve(stale, edited)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe("stale")
      expect(result.message).toContain("read it again")
    }
  })

  it("refuses when the file got shorter", () => {
    const result = LineAnchor.resolve(anchorFor(2), lines.slice(0, 1))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe("out-of-range")
  })

  it("does not confuse two lines that share content", () => {
    // Duplicate content hashes identically, so the line number is what separates
    // them — and it is checked first.
    const duplicated = ["same", "same", "same"]
    const anchor = LineAnchor.parse(LineAnchor.format(2, "same"))!
    const result = LineAnchor.resolve(anchor, duplicated)
    expect(result).toEqual({ ok: true, line: 2, text: "same" })
  })

  it("says what the line hashes to now, so the message is actionable", () => {
    const stale = anchorFor(0)
    const result = LineAnchor.resolve(stale, ["const a = 2", ...lines.slice(1)])
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain(LineAnchor.digest("const a = 2"))
  })
})
