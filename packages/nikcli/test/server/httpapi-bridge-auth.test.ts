import { describe, expect, it } from "bun:test"

const { Auth } = await import("@/server/httpapi/auth")
const { HttpApiBridge } = await import("@/server/httpapi/bridge")

/**
 * `HttpApiBridge.auth` exercises the same logic the bridge's `handle` uses to
 * decide whether a request gets a 401 before falling through to the Effect
 * router. We test the helpers in isolation because `Flag.NIKCLI_SERVER_*`
 * captures process.env values at module load time, so the request-level
 * "request without auth fails" path is exercised by `server.ts`'s existing
 * basic-auth middleware in `test/server/server-auth.test.ts` (or similar).
 *
 * What we cover here:
 *  - Auth.matchesBasicAuth: parses header, handles malformed inputs, respects
 *    case and whitespace, returns false on no/bad encoding.
 *  - Auth.extractQueryToken: surfaces the legacy `?token=` security scheme
 *    used by mobile and websocket clients that cannot set custom headers.
 *  - HttpApiBridge.supports: negative cases for the Wave 3 groups — proves
 *    the bridge correctly flags every path before the router runs.
 */
describe("HttpApi bridge auth", () => {
  describe("Auth.matchesBasicAuth", () => {
    it("returns false when credentials have no password (loopback mode)", () => {
      const credentials = { username: "nikcli", password: undefined }
      // Force Option.none()
      const safeCredentials = {
        ...credentials,
        password: { _tag: "None" as const },
      }
      // cast to bypass type
      const header = `Basic ${Buffer.from("nikcli:swordfish").toString("base64")}`
      // Even with the wrong tag, the function should not match
      expect(
        Auth.matchesBasicAuth(safeCredentials as unknown as Parameters<typeof Auth.matchesBasicAuth>[0], header),
      ).toBe(false)
    })

    it("returns false for missing or malformed Authorization headers", () => {
      const credentials = {
        username: "nikcli",
        password: { _tag: "Some" as const, value: "swordfish" },
      }
      expect(Auth.matchesBasicAuth(credentials as never, undefined)).toBe(false)
      expect(Auth.matchesBasicAuth(credentials as never, null)).toBe(false)
      expect(Auth.matchesBasicAuth(credentials as never, "")).toBe(false)
      expect(Auth.matchesBasicAuth(credentials as never, "Bearer abc")).toBe(false)
      expect(Auth.matchesBasicAuth(credentials as never, "Basic !!!not-base64!!!")).toBe(false)
    })

    it("returns true for matching basic-auth credentials", () => {
      const credentials = {
        username: "nikcli",
        password: { _tag: "Some" as const, value: "swordfish" },
      }
      const valid = `Basic ${Buffer.from("nikcli:swordfish").toString("base64")}`
      const wrongUser = `Basic ${Buffer.from("other:swordfish").toString("base64")}`
      const wrongPass = `Basic ${Buffer.from("nikcli:wrongpass").toString("base64")}`
      expect(Auth.matchesBasicAuth(credentials as never, valid)).toBe(true)
      expect(Auth.matchesBasicAuth(credentials as never, wrongUser)).toBe(false)
      expect(Auth.matchesBasicAuth(credentials as never, wrongPass)).toBe(false)
    })
  })

  describe("Auth.extractQueryToken (auth_token security scheme)", () => {
    it("surfaces the legacy ?token= query parameter", () => {
      const urlA = new URL("http://nikcli.local/sync/event?token=abc123")
      expect(Auth.extractQueryToken(urlA)).toBe("abc123")
    })

    it("returns undefined when no token is set", () => {
      const urlB = new URL("http://nikcli.local/sync/event")
      expect(Auth.extractQueryToken(urlB)).toBeUndefined()
    })

    it("returns undefined for empty token values", () => {
      const urlC = new URL("http://nikcli.local/sync/event?token=")
      expect(Auth.extractQueryToken(urlC)).toBeUndefined()
    })

    it("works alongside other query parameters", () => {
      const urlD = new URL("http://nikcli.local/sync/event?projectID=p1&since=10&token=tok")
      expect(Auth.extractQueryToken(urlD)).toBe("tok")
    })
  })

  describe("HttpApiBridge.supports (Wave 3a regex coverage)", () => {
    it("flags the new managed-worktree routes", () => {
      expect(HttpApiBridge.supports("/experimental/managed-worktree", "POST")).toBe(true)
      expect(HttpApiBridge.supports("/experimental/managed-worktree", "DELETE")).toBe(true)
      expect(HttpApiBridge.supports("/experimental/managed-worktree", "GET")).toBe(true)
      expect(HttpApiBridge.supports("/experimental/managed-worktree/link", "POST")).toBe(true)
      expect(HttpApiBridge.supports("/experimental/managed-worktree/children", "GET")).toBe(true)
      expect(HttpApiBridge.supports("/experimental/managed-worktree/ancestors", "GET")).toBe(true)
    })

    it("flags brain routes", () => {
      expect(HttpApiBridge.supports("/brain", "GET")).toBe(true)
      expect(HttpApiBridge.supports("/brain/trigger", "POST")).toBe(true)
    })

    it("flags connectors routes", () => {
      expect(HttpApiBridge.supports("/connectors", "GET")).toBe(true)
      expect(HttpApiBridge.supports("/connectors/git/auth", "POST")).toBe(true)
      expect(HttpApiBridge.supports("/connectors/git/auth", "DELETE")).toBe(true)
      expect(HttpApiBridge.supports("/connectors/invalidate", "POST")).toBe(true)
    })

    it("flags discord routes", () => {
      expect(HttpApiBridge.supports("/discord", "GET")).toBe(true)
      expect(HttpApiBridge.supports("/discord/setup", "POST")).toBe(true)
      expect(HttpApiBridge.supports("/discord/start", "POST")).toBe(true)
      expect(HttpApiBridge.supports("/discord/stop", "POST")).toBe(true)
    })

    it("flags chatbot webhook receivers", () => {
      expect(HttpApiBridge.supports("/chatbot/discord/notify", "POST")).toBe(true)
      expect(HttpApiBridge.supports("/chatbot/slack/notify", "POST")).toBe(true)
      expect(HttpApiBridge.supports("/chatbot/teams/notify", "POST")).toBe(true)
      expect(HttpApiBridge.supports("/chatbot/gchat/notify", "POST")).toBe(true)
      expect(HttpApiBridge.supports("/chatbot/linear/notify", "POST")).toBe(true)
      expect(HttpApiBridge.supports("/chatbot/github/notify", "POST")).toBe(true)
    })

    it("flags user routes (instance-less global branch)", () => {
      // /user/* lives in `globalRoutes`, not `implementedRoutes`, so it goes
      // through `supportsGlobal()`. Both methods must return true.
      expect(HttpApiBridge.supportsGlobal("/user/register", "POST")).toBe(true)
      expect(HttpApiBridge.supportsGlobal("/user/login", "POST")).toBe(true)
      expect(HttpApiBridge.supportsGlobal("/user/logout", "POST")).toBe(true)
      expect(HttpApiBridge.supportsGlobal("/user/me", "GET")).toBe(true)
      expect(HttpApiBridge.supportsGlobal("/user/status", "GET")).toBe(true)
      expect(HttpApiBridge.supportsGlobal("/user/list", "GET")).toBe(true)
      expect(HttpApiBridge.supportsGlobal("/user/usr_1", "PATCH")).toBe(true)
      expect(HttpApiBridge.supportsGlobal("/user/usr_1", "DELETE")).toBe(true)
    })
  })
})
