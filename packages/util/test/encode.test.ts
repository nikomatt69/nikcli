import { describe, expect, test } from "bun:test"
import { base64Decode, base64Encode, checksum, hash } from "../src/encode"

describe("base64Encode / base64Decode", () => {
  test("round-trips ASCII", () => {
    for (const input of ["", "a", "ab", "abc", "hello world"]) {
      expect(base64Decode(base64Encode(input))).toBe(input)
    }
  })

  test("round-trips multi-byte UTF-8", () => {
    for (const input of ["héllo ✓", "日本語", "🎉 emoji"]) {
      expect(base64Decode(base64Encode(input))).toBe(input)
    }
  })

  test("emits URL-safe alphabet without padding", () => {
    const encoded = base64Encode("?>~+/=")
    expect(encoded).toBe("Pz5-Ky89")
    expect(encoded).not.toContain("+")
    expect(encoded).not.toContain("/")
    expect(encoded).not.toContain("=")
  })

  test("decodes unpadded input", () => {
    // base64Encode strips "=", so the decoder has to tolerate its own output.
    expect(base64Decode("YQ")).toBe("a")
    expect(base64Decode("YWI")).toBe("ab")
  })
})

describe("checksum", () => {
  test("returns undefined for empty input", () => {
    expect(checksum("")).toBeUndefined()
  })

  test("is deterministic", () => {
    expect(checksum("abc")).toBe(checksum("abc"))
  })

  test("differs for different input", () => {
    expect(checksum("abc")).not.toBe(checksum("abd"))
  })

  test("emits base36 of an unsigned 32-bit value", () => {
    const out = checksum("some longer content to hash")!
    expect(out).toMatch(/^[0-9a-z]+$/)
    expect(Number.parseInt(out, 36)).toBeLessThanOrEqual(0xffffffff)
  })
})

describe("hash", () => {
  test("returns lowercase hex SHA-256 by default", async () => {
    // Known vector for the empty string.
    expect(await hash("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")
  })

  test("is deterministic and input-sensitive", async () => {
    expect(await hash("abc")).toBe(await hash("abc"))
    expect(await hash("abc")).not.toBe(await hash("abd"))
  })

  test("honours an explicit algorithm", async () => {
    expect(await hash("abc", "SHA-1")).toBe("a9993e364706816aba3e25717850c26c9cd0d89d")
  })
})
