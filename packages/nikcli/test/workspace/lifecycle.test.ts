import { describe, expect, it } from "bun:test"
import { readFileSync } from "fs"
import path from "path"

describe("Workspace lifecycle", () => {
  it("registers exit handlers once via the connection module", () => {
    const source = readFileSync(path.join(import.meta.dir, "../../src/workspace/connection.ts"), "utf8")
    expect(source).toContain("registerProcessCleanup")
    expect(source).toContain('process.once("SIGTERM"')
    expect(source).toMatch(/process\.once\("SIGTERM"/)
  })

  it("delegates cleanup registration to the connection module", () => {
    const indexSource = readFileSync(path.join(import.meta.dir, "../../src/workspace/index.ts"), "utf8")
    expect(indexSource).toContain("WorkspaceConnection.registerProcessCleanup()")
    expect(indexSource).not.toMatch(/process\.once\("SIGTERM"/)
  })
})
