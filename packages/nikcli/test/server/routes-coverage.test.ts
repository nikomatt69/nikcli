import { describe, expect, it } from "bun:test"
import {
  handlerRoutes,
  inventoryFailures,
  publicRoutes,
  rawRouteImplementations,
  routeKey,
} from "@/server/httpapi/inventory"

describe("PublicApi route inventory", () => {
  it("covers every contract with exactly one handler or raw implementation", () => {
    expect(publicRoutes().length).toBeGreaterThan(250)
    expect(handlerRoutes().length).toBeGreaterThan(150)
    expect(rawRouteImplementations.size).toBeGreaterThan(0)
    expect(handlerRoutes().length + rawRouteImplementations.size).toBe(publicRoutes().length)
    expect(inventoryFailures()).toEqual([])
  })

  it("preserves unique operation IDs and response status contracts", () => {
    const routes = publicRoutes()
    expect(new Set(routes.map((route) => route.operationId)).size).toBe(routes.length)
    expect(routes.filter((route) => route.statuses.length === 0).map(routeKey)).toEqual([])
  })
})
