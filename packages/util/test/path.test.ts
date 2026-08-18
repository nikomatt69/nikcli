import { describe, expect, test } from "bun:test"
import {
  getDirectory,
  getFileExtension,
  getFilename,
  getFilenameTruncated,
  truncateMiddle,
} from "../src/path"

describe("getFilename", () => {
  test("returns the last segment for both separators", () => {
    expect(getFilename("/a/b/c.ts")).toBe("c.ts")
    expect(getFilename("C:\\a\\b\\c.ts")).toBe("c.ts")
    expect(getFilename("a/b\\c.ts")).toBe("c.ts")
  })

  test("ignores trailing separators", () => {
    expect(getFilename("/a/b/")).toBe("b")
    expect(getFilename("/a/b///")).toBe("b")
    expect(getFilename("C:\\a\\b\\")).toBe("b")
  })

  test("returns empty string for empty input", () => {
    expect(getFilename("")).toBe("")
    expect(getFilename(undefined)).toBe("")
  })

  test("returns the input when there is no separator", () => {
    expect(getFilename("c.ts")).toBe("c.ts")
  })
})

describe("getDirectory", () => {
  test("returns the parent path with a trailing slash", () => {
    expect(getDirectory("/a/b/c.ts")).toBe("/a/b/")
    expect(getDirectory("C:\\a\\b\\c.ts")).toBe("C:/a/b/")
  })

  test("normalizes backslashes to forward slashes", () => {
    expect(getDirectory("a\\b\\c.ts")).toBe("a/b/")
  })

  test("ignores trailing separators", () => {
    expect(getDirectory("/a/b/")).toBe("/a/")
  })

  test("returns empty string for empty input", () => {
    expect(getDirectory("")).toBe("")
    expect(getDirectory(undefined)).toBe("")
  })

  // Characterization, not endorsement: a bare filename has no parent, but the
  // unconditional trailing "/" makes it claim the filesystem root. Callers pass
  // full paths today, so this is recorded rather than changed.
  test("reports root for a bare filename", () => {
    expect(getDirectory("file.ts")).toBe("/")
  })
})

describe("getFileExtension", () => {
  test("returns the trailing extension", () => {
    expect(getFileExtension("a/b/c.ts")).toBe("ts")
    expect(getFileExtension("archive.tar.gz")).toBe("gz")
  })

  test("returns empty string for empty input", () => {
    expect(getFileExtension("")).toBe("")
    expect(getFileExtension(undefined)).toBe("")
  })

  // Characterization: the split is on "." across the whole path with no regard
  // for separators, so an extensionless file echoes its own name and a dotted
  // directory swallows the segments after it.
  test("echoes the input when there is no dot", () => {
    expect(getFileExtension("README")).toBe("README")
  })

  test("crosses separators when a directory contains a dot", () => {
    expect(getFileExtension("a/b.c/d")).toBe("c/d")
  })
})

describe("getFilenameTruncated", () => {
  test("returns short filenames untouched", () => {
    expect(getFilenameTruncated("/a/b/c.ts", 20)).toBe("c.ts")
  })

  test("keeps the extension when truncating", () => {
    expect(getFilenameTruncated("verylongfilename.txt", 12)).toBe("verylon….txt")
  })

  test("drops the extension when there is no room for it", () => {
    expect(getFilenameTruncated("verylongname.txt", 5)).toBe("very…")
  })

  test("treats a leading dot as part of the name, not an extension", () => {
    expect(getFilenameTruncated(".gitignore", 6)).toBe(".giti…")
  })
})

describe("truncateMiddle", () => {
  test("returns text at or under the cap untouched", () => {
    expect(truncateMiddle("hello", 5)).toBe("hello")
    expect(truncateMiddle("hello", 10)).toBe("hello")
  })

  test("elides the middle and respects the cap", () => {
    expect(truncateMiddle("abcdefghij", 5)).toBe("ab…ij")
    expect(truncateMiddle("abcdefghij", 5)).toHaveLength(5)
    expect(truncateMiddle("hello", 3)).toBe("h…o")
  })

  // Regression: `slice(-0)` is `slice(0)` and returned the whole string, so a
  // cap of 1 or 2 produced output longer than the input it was capping.
  test("never exceeds the cap at the degenerate low end", () => {
    expect(truncateMiddle("hello", 2)).toBe("h…")
    expect(truncateMiddle("hello", 1)).toBe("…")
  })

  test("never returns more than maxLength characters", () => {
    const text = "the quick brown fox jumps over the lazy dog"
    for (let max = 1; max <= text.length + 2; max += 1) {
      expect({ max, length: truncateMiddle(text, max).length }).toEqual({
        max,
        length: Math.min(max, text.length),
      })
    }
  })
})
