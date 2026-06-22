import { describe, expect, it } from "bun:test"
import { readFileSync } from "fs"
import path from "path"

describe("Workspace lifecycle", () => {
  it("registers exit handlers once via process.once guard", () => {
    const source = readFileSync(path.join(import.meta.dir, "../../src/workspace/index.ts"), "utf8")
    expect(source).toContain("workspaceCleanupRegistered")
    expect(source).toContain('process.once("SIGTERM"')
    expect(source).not.toMatch(/process\.on\("SIGTERM"/)
  })
})
