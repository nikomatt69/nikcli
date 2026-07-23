import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { ApplyPatchTool } from "@/tool/apply_patch"
import { Instance } from "@/project/instance"
import { makeToolContext, withProjectDirectory } from "../helpers/tool-context"

describe("ApplyPatchTool", () => {
  let projectDir: string
  let def: Awaited<ReturnType<typeof ApplyPatchTool.init>>

  beforeAll(async () => {
    projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-apply-patch-"))
    def = await withProjectDirectory(projectDir, () => ApplyPatchTool.init())
  })

  afterAll(async () => {
    await Instance.disposeAll().catch(() => undefined)
    await fs.rm(projectDir, { recursive: true, force: true }).catch(() => {})
  })

  it("adds a new file from a well-formed patch", async () => {
    const { ctx, asked } = makeToolContext()
    const patchText = `*** Begin Patch
*** Add File: hello.txt
+hi from patch
*** End Patch`
    const result = await withProjectDirectory(projectDir, () => def.executeAsync({ patchText }, ctx))
    expect(result.output.toLowerCase()).toMatch(/success|applied|patch/)
    expect(await fs.readFile(path.join(projectDir, "hello.txt"), "utf-8")).toContain("hi from patch")
    expect(asked.some((a) => a.permission === "edit")).toBe(true)
  })

  it("updates an existing file", async () => {
    await fs.writeFile(path.join(projectDir, "update-me.txt"), "line1\nold\nline3\n")
    const { ctx } = makeToolContext()
    const patchText = `*** Begin Patch
*** Update File: update-me.txt
@@
 line1
-old
+new
 line3
*** End Patch`
    const result = await withProjectDirectory(projectDir, () => def.executeAsync({ patchText }, ctx))
    expect(result.output.toLowerCase()).toMatch(/success|applied|patch/)
    expect(await fs.readFile(path.join(projectDir, "update-me.txt"), "utf-8")).toBe("line1\nnew\nline3\n")
  })

  it("rejects an empty patch envelope", async () => {
    const { ctx } = makeToolContext()
    await expect(
      withProjectDirectory(projectDir, () =>
        def.executeAsync({ patchText: "*** Begin Patch\n*** End Patch" }, ctx),
      ),
    ).rejects.toThrow(/empty patch|no hunks/)
  })

  it("rejects malformed patch text", async () => {
    const { ctx } = makeToolContext()
    await expect(
      withProjectDirectory(projectDir, () => def.executeAsync({ patchText: "not a patch" }, ctx)),
    ).rejects.toThrow(/apply_patch verification failed/)
  })

  it("rejects missing patchText", async () => {
    const { ctx } = makeToolContext()
    await expect(
      withProjectDirectory(projectDir, () => def.executeAsync({ patchText: "" }, ctx)),
    ).rejects.toThrow(/patchText is required/)
  })
})
