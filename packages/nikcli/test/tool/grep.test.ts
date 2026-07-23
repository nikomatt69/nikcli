import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { GrepTool } from "@/tool/grep"
import { Instance } from "@/project/instance"
import { makeToolContext, withProjectDirectory } from "../helpers/tool-context"

describe("GrepTool", () => {
  let projectDir: string
  let def: Awaited<ReturnType<typeof GrepTool.init>>

  beforeAll(async () => {
    projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-grep-test-"))
    await fs.writeFile(path.join(projectDir, "a.ts"), "const alpha = 1\nconst beta = 2\n")
    await fs.writeFile(path.join(projectDir, "b.md"), "alpha in markdown\n")
    await fs.writeFile(path.join(projectDir, "c.ts"), "no match here\n")
    def = await withProjectDirectory(projectDir, () => GrepTool.init())
  })

  afterAll(async () => {
    await Instance.disposeAll().catch(() => undefined)
    await fs.rm(projectDir, { recursive: true, force: true }).catch(() => {})
  })

  it("finds pattern matches and asks grep permission", async () => {
    const { ctx, asked } = makeToolContext()
    const result = await withProjectDirectory(projectDir, () =>
      def.executeAsync({ pattern: "alpha", path: projectDir }, ctx),
    )
    expect(result.output.toLowerCase()).toContain("alpha")
    expect(asked.some((a) => a.permission === "grep")).toBe(true)
  })

  it("respects include filter", async () => {
    const { ctx } = makeToolContext()
    const result = await withProjectDirectory(projectDir, () =>
      def.executeAsync({ pattern: "alpha", path: projectDir, include: "*.ts" }, ctx),
    )
    expect(result.output).toContain("a.ts")
    expect(result.output).not.toContain("b.md")
  })

  it("rejects empty pattern", async () => {
    const { ctx } = makeToolContext()
    await expect(
      withProjectDirectory(projectDir, () => def.executeAsync({ pattern: "", path: projectDir }, ctx)),
    ).rejects.toThrow(/pattern is required/)
  })
})
