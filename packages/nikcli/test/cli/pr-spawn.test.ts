import { describe, expect, it } from "bun:test"
import fs from "fs/promises"
import path from "path"

const root = path.resolve(import.meta.dir, "../..")

describe("PrCommand subprocess wiring", () => {
  it("uses process.execPath for import and TUI re-exec", async () => {
    const source = await fs.readFile(path.join(root, "src/cli/cmd/pr.ts"), "utf8")
    expect(source).toContain("process.execPath")
    expect(source).toContain('"import"')
    expect(source).not.toMatch(/spawn\(\s*["']nikcli["']/)
    expect(source).toContain("process.argv.slice(1, 2)")
  })
})
