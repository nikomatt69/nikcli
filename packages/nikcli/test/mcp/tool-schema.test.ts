import { describe, expect, it } from "bun:test"
import { MCP } from "@/mcp"

describe("MCP tool schemas", () => {
  it("treats a missing input schema as a no-argument tool", () => {
    expect(MCP.normalizeToolInputSchema(undefined)).toEqual({
      type: "object",
      properties: {},
      additionalProperties: false,
    })
  })

  it("preserves declared properties while closing the object", () => {
    expect(
      MCP.normalizeToolInputSchema({
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      }),
    ).toEqual({
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
      additionalProperties: false,
    })
  })
})
