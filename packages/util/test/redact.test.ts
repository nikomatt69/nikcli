import { describe, expect, test } from "bun:test"
import { discover, redactString, redactValue, safeStringify } from "../src/redact"

const REDACTED = "[REDACTED]"

describe("redactString", () => {
  test("masks token-shaped substrings", () => {
    expect(redactString("key sk-abcdefghijklmnop0123 end")).toBe(`key ${REDACTED} end`)
    expect(redactString("ghp_abcdefghijklmnopqrstuvwxyz")).toBe(REDACTED)
    expect(redactString("ghs_abcdefghijklmnopqrstuvwxyz")).toBe(REDACTED)
    expect(redactString("github_pat_abcdefghijklmnopqrstuvwxyz")).toBe(REDACTED)
    expect(redactString("xoxb-1234567890-abcdef")).toBe(REDACTED)
  })

  test("masks JWT-shaped substrings", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk"
    expect(redactString(`auth ${jwt}`)).toBe(`auth ${REDACTED}`)
  })

  test("masks URL query credentials but keeps the key visible", () => {
    expect(redactString("https://x.dev/cb?code=abc123&next=/home")).toBe(
      `https://x.dev/cb?code=${REDACTED}&next=/home`,
    )
    expect(redactString("https://x.dev/a?b=1&access_token=zzz")).toBe(`https://x.dev/a?b=1&access_token=${REDACTED}`)
  })

  test("matches URL credential keys case-insensitively", () => {
    expect(redactString("https://x.dev/a?TOKEN=zzz")).toBe(`https://x.dev/a?TOKEN=${REDACTED}`)
  })

  test("leaves ordinary text verbatim", () => {
    expect(redactString("nothing secret here")).toBe("nothing secret here")
    expect(redactString("")).toBe("")
  })

  test("truncates leaves past the 4096 character cap", () => {
    const long = "a".repeat(5000)
    const out = redactString(long)
    expect(out.endsWith("...[truncated]")).toBe(true)
    expect(out).toHaveLength(4096 + "...[truncated]".length)
  })

  test("is not left stateful by the global regexes across calls", () => {
    const url = "https://x.dev/a?token=zzz"
    expect(redactString(url)).toBe(redactString(url))
    const key = "sk-abcdefghijklmnop0123"
    expect(redactString(key)).toBe(REDACTED)
    expect(redactString(key)).toBe(REDACTED)
  })
})

describe("redactValue", () => {
  test("masks values under known credential keys", () => {
    expect(redactValue({ token: "abc", user: "ada" })).toEqual({ token: REDACTED, user: "ada" })
    expect(redactValue({ password: "hunter2" })).toEqual({ password: REDACTED })
  })

  test("matches credential keys regardless of case or separator style", () => {
    expect(redactValue({ clientSecret: "s" })).toEqual({ clientSecret: REDACTED })
    expect(redactValue({ client_secret: "s" })).toEqual({ client_secret: REDACTED })
    expect(redactValue({ Authorization: "Bearer x" })).toEqual({ Authorization: REDACTED })
  })

  test("recurses into nested objects and arrays", () => {
    expect(redactValue({ a: { b: [{ apikey: "x" }] } })).toEqual({ a: { b: [{ apikey: REDACTED }] } })
  })

  test("passes primitives through untouched", () => {
    expect(redactValue(1)).toBe(1)
    expect(redactValue(true)).toBe(true)
    expect(redactValue(null)).toBe(null)
    expect(redactValue(undefined)).toBe(undefined)
  })

  test("drops functions and symbols", () => {
    expect(redactValue(() => {})).toBeUndefined()
    expect(redactValue(Symbol("s"))).toBeUndefined()
  })

  test("reduces an Error to name and redacted message", () => {
    const err = new Error("failed with sk-abcdefghijklmnop0123")
    expect(redactValue(err)).toEqual({ name: "Error", message: `failed with ${REDACTED}` })
  })

  test("breaks cycles instead of overflowing the stack", () => {
    const cyclic: Record<string, unknown> = { name: "root" }
    cyclic.self = cyclic
    expect(redactValue(cyclic)).toEqual({ name: "root", self: "[circular]" })
  })

  test("stops at the depth cap", () => {
    expect(redactValue({ a: { b: { c: { d: { e: "deep" } } } } })).toEqual({
      a: { b: { c: { d: { e: "[max-depth]" } } } },
    })
  })

  // Characterization: the WeakSet marks every visited object, so a value shared
  // by two sibling keys reads as circular on the second visit even though the
  // graph is acyclic.
  test("reports a repeated sibling reference as circular", () => {
    const shared = { v: 1 }
    expect(redactValue({ a: shared, b: shared })).toEqual({ a: { v: 1 }, b: "[circular]" })
  })
})

describe("safeStringify", () => {
  test("serializes redacted values", () => {
    expect(safeStringify({ token: "abc", user: "ada" })).toBe(`{"token":"${REDACTED}","user":"ada"}`)
  })

  test("returns the string 'undefined' for undefined", () => {
    expect(safeStringify(undefined)).toBe("undefined")
  })

  test("survives cyclic input", () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(safeStringify(cyclic)).toBe('{"self":"[circular]"}')
  })

  test("reports unserializable values instead of throwing", () => {
    expect(safeStringify({ big: 1n })).toBe("[unserializable]")
  })
})

describe("discover", () => {
  test("finds token-shaped substrings", () => {
    expect(discover("use sk-abcdefghijklmnop0123 now")).toEqual(["sk-abcdefghijklmnop0123"])
  })

  test("finds credential keys in objects", () => {
    expect(discover({ token: "abc" })).toEqual([`token=${REDACTED}`])
  })

  test("finds URL query credentials", () => {
    expect(discover("https://x.dev/cb?code=abc123")).toEqual(["?code=abc123"])
  })

  test("returns an empty array for clean input", () => {
    expect(discover("nothing to see")).toEqual([])
    expect(discover({ user: "ada", count: 3 })).toEqual([])
  })

  test("is repeatable across calls despite the shared global regexes", () => {
    const input = { note: "https://x.dev/a?token=zzz", key: "sk-abcdefghijklmnop0123" }
    expect(discover(input)).toEqual(discover(input))
  })
})
