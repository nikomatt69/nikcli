import { describe, expect, it } from "bun:test"
import { preserveOriginalShape } from "@/tool/write"

describe("preserveOriginalShape (opencode #20217)", () => {
  it("preserves CRLF when original was CRLF", () => {
    const original = "line1\r\nline2\r\nline3"
    const written = "line1\nline2\nline3"
    expect(preserveOriginalShape(original, written)).toBe("line1\r\nline2\r\nline3")
  })

  it("converts CRLF to LF when original was LF only", () => {
    const original = "line1\nline2\nline3"
    const written = "line1\r\nline2\r\nline3"
    expect(preserveOriginalShape(original, written)).toBe("line1\nline2\nline3")
  })

  it("preserves UTF-8 BOM when original had one", () => {
    const original = "\ufeffhello\nworld"
    const written = "hello\nworld"
    expect(preserveOriginalShape(original, written)).toBe("\ufeffhello\nworld")
  })

  it("does not duplicate BOM if already present", () => {
    const original = "\ufeffhello\nworld"
    const written = "\ufeffhello\nworld"
    expect(preserveOriginalShape(original, written)).toBe("\ufeffhello\nworld")
  })

  it("returns written unchanged for empty original (new file)", () => {
    expect(preserveOriginalShape("", "fresh\ncontent")).toBe("fresh\ncontent")
  })
})
