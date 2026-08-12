import { describe, expect, it } from "bun:test"
import { HttpApiBridge } from "@/server/httpapi/bridge"

describe("Server backend", () => {
  it("exposes the Effect HttpApi web handler", () => {
    expect(typeof HttpApiBridge.webHandler).toBe("function")
    expect(HttpApiBridge.layer).toBeDefined()
  })
})
