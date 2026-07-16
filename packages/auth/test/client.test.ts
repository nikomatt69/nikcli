import { describe, expect, test } from "bun:test"
import { createTokenClient, type StoredTokens } from "../src/client"

describe("createTokenClient", () => {
  test("refreshes once for concurrent callers and persists rotation", async () => {
    let stored: StoredTokens | undefined = {
      access: "old",
      refresh: "refresh-old",
      expires: Date.now() - 1,
    }
    let calls = 0
    const client = createTokenClient({
      issuer: "https://auth.test",
      clientID: "nikcli",
      store: {
        get: () => stored,
        set: (tokens) => {
          stored = tokens
        },
      },
      fetch: async (_input, init) => {
        calls++
        const body = new URLSearchParams(String(init?.body))
        expect(body.get("refresh_token")).toBe("refresh-old")
        await Bun.sleep(5)
        return Response.json({
          access_token: "new",
          refresh_token: "refresh-new",
          expires_in: 900,
        })
      },
    })

    const values = await Promise.all([
      client.getValidAccessToken(),
      client.getValidAccessToken(),
      client.getValidAccessToken(),
    ])
    expect(values).toEqual(["new", "new", "new"])
    expect(calls).toBe(1)
    expect(stored?.refresh).toBe("refresh-new")
  })

  test("reuses a fresh token without network I/O", async () => {
    const client = createTokenClient({
      issuer: "https://auth.test",
      clientID: "nikcli",
      store: {
        get: () => ({
          access: "fresh",
          refresh: "refresh",
          expires: Date.now() + 120_000,
        }),
        set: () => undefined,
      },
      fetch: async () => {
        throw new Error("unexpected fetch")
      },
    })
    expect(await client.getValidAccessToken()).toBe("fresh")
  })
})
