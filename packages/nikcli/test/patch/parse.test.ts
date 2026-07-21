import { describe, expect, it } from "bun:test"
import { Patch } from "@/patch"
import { normalizeUnicode } from "@/patch/fuzzy-match"

describe("Patch.parsePatch envelope boundaries", () => {
  const validBody = `*** Begin Patch
*** Add File: hello.txt
+hi
*** End Patch`

  it("accepts a well-formed envelope", () => {
    const { hunks } = Patch.parsePatch(validBody)
    expect(hunks).toHaveLength(1)
    expect(hunks[0]).toMatchObject({ type: "add", path: "hello.txt" })
  })

  it("rejects content before Begin marker", () => {
    expect(() => Patch.parsePatch(`noise\n${validBody}`)).toThrow(/first non-empty line/)
  })

  it("rejects content after End marker", () => {
    expect(() => Patch.parsePatch(`${validBody}\ntrailing`)).toThrow(/last/)
  })

  it("allows blank lines outside markers but not non-empty noise", () => {
    const withBlanks = `\n\n${validBody}\n\n`
    const { hunks } = Patch.parsePatch(withBlanks)
    expect(hunks).toHaveLength(1)
  })
})

describe("normalizeUnicode", () => {
  it("maps unicode minus U+2212 to ASCII hyphen", () => {
    expect(normalizeUnicode("a\u2212b")).toBe("a-b")
  })

  it("maps en/em dashes to hyphen", () => {
    expect(normalizeUnicode("a\u2013b\u2014c")).toBe("a-b-c")
  })

  it("maps smart quotes", () => {
    expect(normalizeUnicode("\u201Chello\u201D")).toBe('"hello"')
  })
})
