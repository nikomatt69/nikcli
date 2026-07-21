import { describe, expect, it } from "bun:test"
import { WriteTool } from "@/tool/write"

describe("WriteTool parameters (opencode #29943)", () => {
  it("declares filePath before content in the schema property order", async () => {
    // Tool.define returns { id, init } where init() builds the full def.
    const def = await (WriteTool as unknown as { init: () => Promise<{ parameters: unknown }> }).init()
    const json = JSON.stringify(def.parameters)
    const filePathIdx = json.indexOf('"filePath"')
    const contentIdx = json.indexOf('"content"')
    expect(filePathIdx).toBeGreaterThan(-1)
    expect(contentIdx).toBeGreaterThan(-1)
    expect(filePathIdx).toBeLessThan(contentIdx)
  })
})
