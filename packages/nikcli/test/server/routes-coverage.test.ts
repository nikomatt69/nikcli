import { describe, expect, it } from "bun:test"
import { HttpApiBridge } from "@/server/httpapi/bridge"

describe("HttpApi bridge route coverage", () => {
  it("exposes a non-empty implemented route table", () => {
    const routes = HttpApiBridge.listImplemented()
    expect(routes.length).toBeGreaterThan(50)
    expect(routes.some((r) => r.scope === "global")).toBe(true)
    expect(routes.some((r) => r.scope === "main")).toBe(true)
  })

  it("every bridge pattern matches supports()/supportsGlobal() for a sample path", () => {
    const failures: string[] = []
    for (const route of HttpApiBridge.listImplemented()) {
      const sample = HttpApiBridge.samplePathFor(route.pattern)
      const ok =
        route.scope === "global"
          ? HttpApiBridge.supportsGlobal(sample, route.method)
          : HttpApiBridge.supports(sample, route.method)
      if (!ok) failures.push(`${route.method} ${route.pattern} sample=${sample}`)
    }
    expect(failures).toEqual([])
  })

  it("samplePathFor strips anchors and fills dynamic segments", () => {
    expect(HttpApiBridge.samplePathFor("^\\/session\\/[^/]+\\/message$")).toBe("/session/x/message")
    expect(HttpApiBridge.samplePathFor("^\\/chatbot\\/(discord|slack)\\/[^/]+$")).toBe("/chatbot/discord/x")
  })
})
