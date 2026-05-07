import { afterAll, beforeEach, describe, expect, it } from "bun:test"
import { Effect } from "effect"
import fs from "fs/promises"
import os from "os"
import path from "path"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-mcp-auth-effect-home-"))
process.env.NIKCLI_TEST_HOME = testHome

const { McpAuth } = await import("@/mcp/auth")

function runMcpAuth<A, E>(effect: Effect.Effect<A, E, any>) {
  return Effect.runPromise(effect.pipe(Effect.provide(McpAuth.defaultLayer)) as Effect.Effect<A, E, never>)
}

describe("McpAuth.Service", () => {
  beforeEach(async () => {
    await fs.rm(path.join(testHome, "data", "mcp-auth.json"), { force: true })
    await fs.mkdir(path.join(testHome, "data"), { recursive: true })
  })

  it("stores and reads OAuth credentials through the Effect service boundary", async () => {
    const result = await runMcpAuth(
      Effect.gen(function* () {
        const auth = yield* McpAuth.Service
        yield* auth.updateClientInfo("remote", { clientId: "client" }, "https://example.com/mcp")
        yield* auth.updateTokens(
          "remote",
          {
            accessToken: "access",
            refreshToken: "refresh",
            expiresAt: Date.now() / 1000 + 3600,
            scope: "read",
          },
          "https://example.com/mcp",
        )
        yield* auth.updateCodeVerifier("remote", "verifier")
        yield* auth.updateOAuthState("remote", "state")

        const entry = yield* auth.getForUrl("remote", "https://example.com/mcp")
        const mismatch = yield* auth.getForUrl("remote", "https://other.example/mcp")
        const expired = yield* auth.isTokenExpired("remote")

        yield* auth.clearCodeVerifier("remote")
        yield* auth.clearOAuthState("remote")
        const cleared = yield* auth.get("remote")

        return { entry, mismatch, expired, cleared }
      }),
    )

    expect(result.entry?.clientInfo?.clientId).toBe("client")
    expect(result.entry?.tokens?.accessToken).toBe("access")
    expect(result.entry?.codeVerifier).toBe("verifier")
    expect(result.entry?.oauthState).toBe("state")
    expect(result.mismatch).toBeUndefined()
    expect(result.expired).toBe(false)
    expect(result.cleared?.codeVerifier).toBeUndefined()
    expect(result.cleared?.oauthState).toBeUndefined()
  })
})

afterAll(async () => {
  await fs.rm(testHome, { recursive: true, force: true })
})
