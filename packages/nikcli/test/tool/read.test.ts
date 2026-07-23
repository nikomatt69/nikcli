import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { ReadTool } from "@/tool/read"
import { Instance } from "@/project/instance"
import { makeToolContext, withProjectDirectory } from "../helpers/tool-context"

describe("ReadTool", () => {
  let projectDir: string
  let def: Awaited<ReturnType<typeof ReadTool.init>>

  beforeAll(async () => {
    projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-read-test-"))
    def = await withProjectDirectory(projectDir, () => ReadTool.init())
  })

  afterAll(async () => {
    await Instance.disposeAll().catch(() => undefined)
    await fs.rm(projectDir, { recursive: true, force: true }).catch(() => {})
  })

  it("reads file contents and records a read permission ask", async () => {
    const filePath = path.join(projectDir, "hello.txt")
    await fs.writeFile(filePath, "line1\nline2\n")
    const { ctx, asked } = makeToolContext()
    const result = await withProjectDirectory(projectDir, () =>
      def.executeAsync({ filePath }, ctx),
    )
    expect(result.output).toContain("line1")
    expect(result.output).toContain("line2")
    expect(asked.some((a) => a.permission === "read")).toBe(true)
  })

  it("respects offset and limit", async () => {
    const filePath = path.join(projectDir, "numbered.txt")
    await fs.writeFile(filePath, "a\nb\nc\nd\ne\n")
    const { ctx } = makeToolContext()
    const result = await withProjectDirectory(projectDir, () =>
      def.executeAsync({ filePath, offset: 2, limit: 2 }, ctx),
    )
    expect(result.output).toContain("b")
    expect(result.output).toContain("c")
    expect(result.output).not.toMatch(/^\d+: a$/m)
    expect(result.output).not.toMatch(/^\d+: e$/m)
    expect(result.output).toContain("2: b")
    expect(result.output).toContain("3: c")
  })

  it("rejects offset less than 1", async () => {
    const filePath = path.join(projectDir, "x.txt")
    await fs.writeFile(filePath, "x\n")
    const { ctx } = makeToolContext()
    await expect(
      withProjectDirectory(projectDir, () => def.executeAsync({ filePath, offset: 0 }, ctx)),
    ).rejects.toThrow(/offset must be/)
  })

  it("throws File not found for missing paths", async () => {
    const filePath = path.join(projectDir, "missing-unique-xyz.txt")
    const { ctx } = makeToolContext()
    await expect(
      withProjectDirectory(projectDir, () => def.executeAsync({ filePath }, ctx)),
    ).rejects.toThrow(/File not found/)
  })
})
