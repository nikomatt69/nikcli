import { describe, expect, test } from "bun:test"
import {
  OAUTH_CLIENT_ID,
  OAUTH_REDIRECT_URI,
  createAuthorizationRequest,
  exchangeAuthorizationCode,
  parseAuthCallback,
  refreshOAuthTokens,
} from "./account-oauth"

describe("desktop OAuth", () => {
  test("creates an S256 authorization request", async () => {
    const result = await createAuthorizationRequest(123)
    const url = new URL(result.url)
    expect(url.pathname).toBe("/authorize")
    expect(url.searchParams.get("client_id")).toBe(OAUTH_CLIENT_ID)
    expect(url.searchParams.get("redirect_uri")).toBe(OAUTH_REDIRECT_URI)
    expect(url.searchParams.get("state")).toBe(result.pending.state)
    expect(url.searchParams.get("code_challenge_method")).toBe("S256")
    expect(url.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(result.pending.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(result.pending.created).toBe(123)
  })

  test("accepts only the registered auth callback", () => {
    expect(parseAuthCallback("nikcli://auth/callback?code=abc&state=xyz")).toEqual({
      code: "abc",
      state: "xyz",
      error: undefined,
    })
    expect(parseAuthCallback("nikcli://open-project?code=abc")).toBeUndefined()
    expect(parseAuthCallback("https://auth/callback?code=abc")).toBeUndefined()
  })

  test("exchanges the code with its verifier", async () => {
    const token = await exchangeAuthorizationCode("code", "verifier", async (_input, init) => {
      const body = new URLSearchParams(String(init?.body))
      expect(body.get("grant_type")).toBe("authorization_code")
      expect(body.get("code_verifier")).toBe("verifier")
      return Response.json({
        access_token: "access",
        refresh_token: "refresh",
        expires_in: 900,
      })
    })
    expect(token.access).toBe("access")
    expect(token.refresh).toBe("refresh")
    expect(token.expires).toBeGreaterThan(Date.now())
  })

  test("keeps the refresh token when rotation omits a replacement", async () => {
    const token = await refreshOAuthTokens({ access: "old", refresh: "refresh", expires: 1 }, async () =>
      Response.json({ access_token: "new", expires_in: 900 }),
    )
    expect(token.access).toBe("new")
    expect(token.refresh).toBe("refresh")
  })
})
