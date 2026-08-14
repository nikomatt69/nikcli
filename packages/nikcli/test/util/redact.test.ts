import { describe, expect, test } from "bun:test"
import { redactString, redactValue, safeStringify, discover } from "@nikcli-ai/util/redact"

describe("redactString", () => {
  test("masks token query credentials in URLs", () => {
    const input = "https://example.com/cb?token=secret123&foo=bar&code=oauth"
    const out = redactString(input)
    expect(out).toContain("token=[REDACTED]")
    expect(out).toContain("code=[REDACTED]")
    expect(out).not.toContain("secret123")
    expect(out).toContain("foo=bar")
  })

  test("masks OpenAI-style API keys", () => {
    const input = "Using key sk-abcdef1234567890abcdef for inference"
    const out = redactString(input)
    expect(out).toContain("[REDACTED]")
    expect(out).not.toContain("sk-abcdef")
  })

  test("masks GitHub PATs", () => {
    const input = "auth header: ghp_aaaaaaaaaaaaaaaaaaaa"
    const out = redactString(input)
    expect(out).toContain("[REDACTED]")
    expect(out).not.toContain("ghp_aaa")
  })

  test("masks JWT shape", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.signature"
    const out = redactString(`bearer ${jwt}`)
    expect(out).toContain("[REDACTED]")
    expect(out).not.toContain("eyJhbGciOiJI")
  })

  test("preserves the rest of the string", () => {
    const input = "Hello world, this is a normal sentence"
    expect(redactString(input)).toBe(input)
  })

  test("truncates overly long strings", () => {
    const input = "x".repeat(8000)
    const out = redactString(input)
    expect(out).toContain("...[truncated]")
    expect(out.length).toBeLessThan(4200)
  })
})

describe("redactValue", () => {
  test("redacts keys in the known list", () => {
    const out = redactValue({ token: "secret", user: "alice" })
    expect(out).toEqual({ token: "[REDACTED]", user: "alice" })
  })

  test("is case-insensitive on key names", () => {
    const out = redactValue({
      Token: "secret",
      Authorization: "Bearer x",
      password: "p",
    })
    expect(out).toEqual({
      Token: "[REDACTED]",
      Authorization: "[REDACTED]",
      password: "[REDACTED]",
    })
  })

  test("redacts nested objects", () => {
    const out = redactValue({
      config: {
        oauth: { clientSecret: "secret", redirect: "https://x" },
      },
    })
    const cfg = (out as { config: { oauth: { clientSecret: string; redirect: string } } }).config.oauth
    expect(cfg.clientSecret).toBe("[REDACTED]")
    expect(cfg.redirect).toBe("https://x")
  })

  test("breaks cycles", () => {
    const a: { token: string; self?: unknown } = { token: "secret" }
    a.self = a
    const out = redactValue(a)
    expect((out as { token: string }).token).toBe("[REDACTED]")
    expect((out as { self: unknown }).self).toBe("[circular]")
  })

  test("caps depth", () => {
    const inner: Record<string, unknown> = { token: "secret" }
    let cur = inner
    for (let i = 0; i < 10; i++) {
      const next: Record<string, unknown> = {}
      next.next = cur
      cur = next
    }
    const out = redactValue(cur)
    // Beyond depth 4 the value is replaced with "[max-depth]"
    expect(JSON.stringify(out)).toContain("[max-depth]")
  })

  test("redacts array elements", () => {
    const out = redactValue([{ token: "secret" }, { token: "secret2" }])
    expect(out).toEqual([{ token: "[REDACTED]" }, { token: "[REDACTED]" }])
  })

  test("handles errors", () => {
    const err = new Error("OAuth callback failed: https://x?code=secret123")
    const out = redactValue(err)
    expect(out).toEqual({
      name: "Error",
      message: "OAuth callback failed: https://x?code=[REDACTED]",
    })
  })
})

describe("safeStringify", () => {
  test("returns a string for any value", () => {
    expect(typeof safeStringify({ token: "secret" })).toBe("string")
    expect(typeof safeStringify("hello")).toBe("string")
    expect(typeof safeStringify(undefined)).toBe("string")
  })

  test("masks secrets in the output", () => {
    const out = safeStringify({ token: "secret", user: "alice" })
    expect(out).toContain("[REDACTED]")
    expect(out).not.toContain("secret")
    expect(out).toContain("alice")
  })

  test("handles unserializable values", () => {
    const circular: { token: string; self?: unknown } = { token: "secret" }
    circular.self = circular
    expect(safeStringify(circular)).toContain("[REDACTED]")
  })
})

describe("discover", () => {
  test("finds token-shaped substrings in strings", () => {
    const findings = discover("sk-abcdef1234567890abcdef")
    expect(findings.length).toBeGreaterThan(0)
  })

  test("finds credentials in URLs", () => {
    const findings = discover("redirect=cb?token=abc&code=xyz")
    expect(findings.length).toBeGreaterThan(0)
  })

  test("finds credentials by key name", () => {
    const findings = discover({ password: "p", clientSecret: "s" })
    expect(findings).toContain("password=[REDACTED]")
    expect(findings).toContain("clientSecret=[REDACTED]")
  })

  test("returns empty for safe values", () => {
    expect(discover({ user: "alice", count: 42 })).toEqual([])
  })
})
