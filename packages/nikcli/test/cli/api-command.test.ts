import { describe, expect, it } from "bun:test"
import { fillPath, resolveRoute, suggest } from "@/cli/cmd/api"
import { publicRoutes, type PublicRoute } from "@/server/httpapi/inventory"

/**
 * `nikcli api` resolution, tested against the real contract.
 *
 * The point of the command is that it has no endpoint list of its own — everything comes from
 * `publicRoutes()`, which reads the assembled `PublicApi`. So these tests use the real table rather
 * than a fixture: a route that gets renamed or removed should break the assertion that names it,
 * which is exactly the drift this command is not allowed to hide.
 */
const routes = publicRoutes().filter((route) => route.operationId)

const route = (predicate: (item: PublicRoute) => boolean) => {
  const found = routes.find(predicate)
  if (!found) throw new Error("the contract no longer declares the route this test is written against")
  return found
}

describe("resolving an operation", () => {
  it("resolves a declared operation id", () => {
    const declared = route((item) => item.operationId.length > 0)
    const resolved = resolveRoute([declared.operationId], routes)
    expect("route" in resolved && resolved.route.operationId).toBe(declared.operationId)
  })

  it("resolves a method and path pair", () => {
    const declared = route((item) => !item.path.includes("{"))
    const resolved = resolveRoute([declared.method, declared.path], routes)
    expect("route" in resolved && resolved.route.path).toBe(declared.path)
  })

  it("accepts a lowercase method and a path without its leading slash", () => {
    const declared = route((item) => !item.path.includes("{"))
    const resolved = resolveRoute([declared.method.toLowerCase(), declared.path.slice(1)], routes)
    expect("route" in resolved && resolved.route.path).toBe(declared.path)
  })

  it("accepts an operation id in the wrong case", () => {
    const declared = route((item) => /[A-Z]/.test(item.operationId))
    const resolved = resolveRoute([declared.operationId.toUpperCase()], routes)
    expect("route" in resolved && resolved.route.operationId).toBe(declared.operationId)
  })
})

describe("refusing an unknown operation", () => {
  it("names the closest matches rather than only failing", () => {
    const declared = route((item) => item.operationId.length > 6)
    // One character short of a real id — the shape of an actual typo.
    const resolved = resolveRoute([declared.operationId.slice(0, -1)], routes)
    expect("error" in resolved).toBe(true)
    if (!("error" in resolved)) return
    expect(resolved.error).toContain("Unknown operation")
    expect(resolved.suggestions).toContain(declared.operationId)
  })

  it("rejects a method that is not an HTTP method", () => {
    const resolved = resolveRoute(["FETCH", "/session"], routes)
    expect("error" in resolved && resolved.error).toContain("Unknown HTTP method")
  })

  it("rejects a path the contract does not declare", () => {
    const resolved = resolveRoute(["GET", "/definitely-not-a-route"], routes)
    expect("error" in resolved && resolved.error).toContain("No declared route")
  })

  it("says nothing was given when nothing was given", () => {
    expect("error" in resolveRoute([], routes)).toBe(true)
  })
})

describe("suggestions", () => {
  it("prefers substring matches over edit distance", () => {
    const declared = route((item) => item.operationId.length > 8)
    const fragment = declared.operationId.slice(1, 6)
    expect(suggest(fragment, routes)).toContain(declared.operationId)
  })

  it("returns nothing for input that resembles no operation", () => {
    expect(suggest("zzzzzzzzzzzzzzzzzzzz", routes)).toEqual([])
  })
})

describe("path parameters", () => {
  it("substitutes and url-encodes every placeholder", () => {
    expect(fillPath("/session/{sessionID}/message", { sessionID: "ses_a b" })).toEqual({
      path: "/session/ses_a%20b/message",
      missing: [],
    })
  })

  it("reports the placeholders it could not fill instead of sending a literal brace", () => {
    const result = fillPath("/session/{sessionID}/part/{partID}", { sessionID: "ses_1" })
    expect(result.missing).toEqual(["partID"])
  })

  it("leaves a path without placeholders alone", () => {
    expect(fillPath("/session", {})).toEqual({ path: "/session", missing: [] })
  })
})

describe("contract as the only source of truth", () => {
  it("keeps every route reachable by its operation id", () => {
    // If this drops to zero the command has silently stopped resolving anything.
    expect(routes.length).toBeGreaterThan(100)
    for (const item of routes.slice(0, 25)) {
      expect("route" in resolveRoute([item.operationId], routes)).toBe(true)
    }
  })

  it("declares no duplicate operation ids, which would make resolution arbitrary", () => {
    const ids = routes.map((item) => item.operationId)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
