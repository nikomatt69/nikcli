import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { GlobTool } from "@/tool/glob"
import { Instance } from "@/project/instance"
import { makeToolContext, withProjectDirectory } from "../helpers/tool-context"

describe("GlobTool", () => {
  let projectDir: string
  let def: Awaited<ReturnType<typeof GlobTool.init>>

  beforeAll(async () => {
    projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-glob-test-"))
    await fs.writeFile(path.join(projectDir, "a.ts"), "a\n")
    await fs.writeFile(path.join(projectDir, "b.ts"), "b\n")
    await fs.writeFile(path.join(projectDir, "c.md"), "c\n")
    await fs.mkdir(path.join(projectDir, "nested"))
    await fs.writeFile(path.join(projectDir, "nested", "d.ts"), "d\n")
    def = await withProjectDirectory(projectDir, () => GlobTool.init())
  })

  afterAll(async () => {
    await Instance.disposeAll().catch(() => undefined)
    await fs.rm(projectDir, { recursive: true, force: true }).catch(() => {})
  })

  it("matches files by pattern and asks glob permission", async () => {
    const { ctx, asked } = makeToolContext()
    const result = await withProjectDirectory(projectDir, () =>
      def.executeAsync({ pattern: "*.ts", path: projectDir }, ctx),
    )
    expect(result.output).toContain("a.ts")
    expect(result.output).toContain("b.ts")
    expect(result.output).not.toContain("c.md")
    expect(asked.some((a) => a.permission === "glob")).toBe(true)
  })

  it("finds nested matches with ** patterns", async () => {
    const { ctx } = makeToolContext()
    const result = await withProjectDirectory(projectDir, () =>
      def.executeAsync({ pattern: "**/*.ts", path: projectDir }, ctx),
    )
    expect(result.output).toContain("nested/d.ts")
  })

  it("defaults the search directory to Instance.directory", async () => {
    const { ctx } = makeToolContext()
    const result = await withProjectDirectory(projectDir, () => def.executeAsync({ pattern: "*.md" }, ctx))
    expect(result.output).toContain("c.md")
  })
})
