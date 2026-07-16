/// <reference types="@types/bun" />

import { describe, expect, test } from "bun:test"
import {
  accessTokenExpiry,
  createTokenTriple,
  parseStoredTokenTriple,
  shouldRefreshToken,
  validateOAuthState,
} from "./oauth-core"

function jwt(payload: Record<string, unknown>): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url")
  return `header.${encoded}.signature`
}

describe("OAuth token helpers", () => {
  test("reads access expiry from JWT claims", () => {
    expect(accessTokenExpiry(jwt({ exp: 1_700_000_000 }))).toBe(1_700_000_000_000)
    expect(accessTokenExpiry("not-a-jwt")).toBeNull()
  })

  test("uses rotated refresh tokens and preserves the prior token when omitted", () => {
    const access = jwt({ exp: 1_700_000_000 })
    expect(createTokenTriple({ accessToken: access, refreshToken: "rotated" }).refresh).toBe("rotated")
    expect(createTokenTriple({ accessToken: access, previousRefreshToken: "prior" }).refresh).toBe("prior")
  })

  test("refreshes within the foreground safety margin", () => {
    const now = 1_000_000
    expect(shouldRefreshToken({ access: "a", refresh: "r", expires: now + 59_000 }, now)).toBe(true)
    expect(shouldRefreshToken({ access: "a", refresh: "r", expires: now + 61_000 }, now)).toBe(false)
  })

  test("rejects missing and mismatched OAuth state", () => {
    expect(() => validateOAuthState("expected", "expected")).not.toThrow()
    expect(() => validateOAuthState("expected", "other")).toThrow("OAuth state validation failed")
    expect(() => validateOAuthState("expected", undefined)).toThrow("OAuth state validation failed")
  })

  test("accepts only complete persisted token triples", () => {
    expect(parseStoredTokenTriple('{"access":"a","refresh":"r","expires":123}')).toEqual({
      access: "a",
      refresh: "r",
      expires: 123,
    })
    expect(parseStoredTokenTriple('{"access":"a","expires":123}')).toBeNull()
    expect(parseStoredTokenTriple("invalid")).toBeNull()
  })
})
