import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { TreeTool } from "@/tool/tree"
import { Instance } from "@/project/instance"
import { makeToolContext, withProjectDirectory } from "../helpers/tool-context"

describe("TreeTool", () => {
  let projectDir: string
  let def: Awaited<ReturnType<typeof TreeTool.init>>

  beforeAll(async () => {
    projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-tree-test-"))
    await fs.writeFile(path.join(projectDir, "root.txt"), "r\n")
    await fs.mkdir(path.join(projectDir, "branch"))
    await fs.writeFile(path.join(projectDir, "branch", "leaf.txt"), "l\n")
    await fs.mkdir(path.join(projectDir, "branch", "deep"))
    await fs.writeFile(path.join(projectDir, "branch", "deep", "bottom.txt"), "b\n")
    def = await withProjectDirectory(projectDir, () => TreeTool.init())
  })

  afterAll(async () => {
    await Instance.disposeAll().catch(() => undefined)
    await fs.rm(projectDir, { recursive: true, force: true }).catch(() => {})
  })

  it("renders a tree and asks tree permission", async () => {
    const { ctx, asked } = makeToolContext()
    const result = await withProjectDirectory(projectDir, () =>
      def.executeAsync({ path: projectDir, maxDepth: 3 }, ctx),
    )
    expect(result.output).toContain("root.txt")
    expect(result.output).toContain("branch")
    expect(asked.some((a) => a.permission === "tree")).toBe(true)
    expect(result.metadata.stats.files).toBeGreaterThan(0)
  })

  it("respects maxDepth", async () => {
    const { ctx } = makeToolContext()
    const shallow = await withProjectDirectory(projectDir, () =>
      def.executeAsync({ path: projectDir, maxDepth: 1 }, ctx),
    )
    expect(shallow.output).toContain("branch")
    expect(shallow.output).not.toContain("bottom.txt")
  })

  it("can list directories only", async () => {
    const { ctx } = makeToolContext()
    const result = await withProjectDirectory(projectDir, () =>
      def.executeAsync({ path: projectDir, onlyDirectories: true, maxDepth: 3 }, ctx),
    )
    expect(result.output).toContain("branch")
    expect(result.output).not.toContain("root.txt")
  })
})
