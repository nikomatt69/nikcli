import { describe, expect, it } from "bun:test"
import { openApiSource } from "@/cli/cmd/generate"

describe("generate OpenAPI source", () => {
  it("defaults to Hono until PublicHttpApi reaches route parity", () => {
    expect(openApiSource({})).toBe("hono")
    expect(openApiSource({ env: "" })).toBe("hono")
  })

  it("uses Effect HttpApi when requested by CLI flag", () => {
    expect(openApiSource({ httpapi: true })).toBe("httpapi")
  })

  it("uses Effect HttpApi for supported SDK env aliases", () => {
    expect(openApiSource({ env: "httpapi" })).toBe("httpapi")
    expect(openApiSource({ env: "effect" })).toBe("httpapi")
    expect(openApiSource({ httpapi: false, env: "httpapi" })).toBe("httpapi")
  })

  it("ignores unsupported env values", () => {
    expect(openApiSource({ env: "hono" })).toBe("hono")
    expect(openApiSource({ env: "true" })).toBe("hono")
  })
})
