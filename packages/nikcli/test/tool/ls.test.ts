import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { ListTool } from "@/tool/ls"
import { Instance } from "@/project/instance"
import { makeToolContext, withProjectDirectory } from "../helpers/tool-context"

describe("ListTool", () => {
  let projectDir: string
  let def: Awaited<ReturnType<typeof ListTool.init>>

  beforeAll(async () => {
    projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-list-test-"))
    await fs.writeFile(path.join(projectDir, "one.txt"), "1\n")
    await fs.mkdir(path.join(projectDir, "subdir"))
    await fs.writeFile(path.join(projectDir, "subdir", "two.txt"), "2\n")
    def = await withProjectDirectory(projectDir, () => ListTool.init())
  })

  afterAll(async () => {
    await Instance.disposeAll().catch(() => undefined)
    await fs.rm(projectDir, { recursive: true, force: true }).catch(() => {})
  })

  it("lists directory entries and asks list permission", async () => {
    const { ctx, asked } = makeToolContext()
    const result = await withProjectDirectory(projectDir, () => def.executeAsync({ path: projectDir }, ctx))
    expect(result.output).toContain("one.txt")
    expect(asked.some((a) => a.permission === "list")).toBe(true)
  })

  it("defaults to Instance.directory when path is omitted", async () => {
    const { ctx } = makeToolContext()
    const result = await withProjectDirectory(projectDir, () => def.executeAsync({}, ctx))
    expect(result.output).toContain("one.txt")
  })

  it("includes nested files under subdirectories", async () => {
    const { ctx } = makeToolContext()
    const result = await withProjectDirectory(projectDir, () => def.executeAsync({ path: projectDir }, ctx))
    expect(result.output).toMatch(/two\.txt|subdir/)
  })
})
