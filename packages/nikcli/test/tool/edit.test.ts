import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { EditTool } from "@/tool/edit"
import { FileTime } from "@/file/time"
import { Instance } from "@/project/instance"
import { makeToolContext, withProjectDirectory } from "../helpers/tool-context"

describe("EditTool", () => {
  let projectDir: string
  let def: Awaited<ReturnType<typeof EditTool.init>>

  beforeAll(async () => {
    projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-edit-test-"))
    def = await withProjectDirectory(projectDir, () => EditTool.init())
  })

  afterAll(async () => {
    await Instance.disposeAll().catch(() => undefined)
    await fs.rm(projectDir, { recursive: true, force: true }).catch(() => {})
  })

  it("replaces a unique string in an existing file", async () => {
    const filePath = path.join(projectDir, "replace.txt")
    await fs.writeFile(filePath, "hello world\n")
    const { ctx, sessionID, asked } = makeToolContext()

    const result = await withProjectDirectory(projectDir, async () => {
      await FileTime.read(sessionID, filePath)
      return def.executeAsync({ filePath, oldString: "world", newString: "nikcli" }, ctx)
    })
    expect(result.output).toContain("Edit applied successfully")
    expect(await fs.readFile(filePath, "utf-8")).toBe("hello nikcli\n")
    expect(asked.some((a) => a.permission === "edit")).toBe(true)
  })

  it("creates a new file when oldString is empty", async () => {
    const filePath = path.join(projectDir, "created.txt")
    const { ctx } = makeToolContext()
    const result = await withProjectDirectory(projectDir, () =>
      def.executeAsync({ filePath, oldString: "", newString: "brand new\n" }, ctx),
    )
    expect(result.output).toContain("Edit applied successfully")
    expect(await fs.readFile(filePath, "utf-8")).toBe("brand new\n")
  })

  it("replaceAll swaps every occurrence", async () => {
    const filePath = path.join(projectDir, "multi.txt")
    await fs.writeFile(filePath, "aa bb aa\n")
    const { ctx, sessionID } = makeToolContext()

    await withProjectDirectory(projectDir, async () => {
      await FileTime.read(sessionID, filePath)
      await def.executeAsync({ filePath, oldString: "aa", newString: "xx", replaceAll: true }, ctx)
    })
    expect(await fs.readFile(filePath, "utf-8")).toBe("xx bb xx\n")
  })

  it("rejects identical oldString and newString", async () => {
    const filePath = path.join(projectDir, "noop.txt")
    await fs.writeFile(filePath, "same\n")
    const { ctx, sessionID } = makeToolContext()

    await expect(
      withProjectDirectory(projectDir, async () => {
        await FileTime.read(sessionID, filePath)
        return def.executeAsync({ filePath, oldString: "same", newString: "same" }, ctx)
      }),
    ).rejects.toThrow(/identical/)
  })

  it("rejects edit when the file was never read", async () => {
    const filePath = path.join(projectDir, "unread.txt")
    await fs.writeFile(filePath, "secret\n")
    const { ctx } = makeToolContext()

    await expect(
      withProjectDirectory(projectDir, () =>
        def.executeAsync({ filePath, oldString: "secret", newString: "public" }, ctx),
      ),
    ).rejects.toThrow(/must read file/)
  })

  it("resolves relative filePath against the Instance directory", async () => {
    const relative = "relative-edit.txt"
    const absolute = path.join(projectDir, relative)
    await fs.writeFile(absolute, "before\n")
    const { ctx, sessionID } = makeToolContext()

    await withProjectDirectory(projectDir, async () => {
      // FileTime keys must match the path EditTool resolves (Instance.directory
      // may be realpath'd, e.g. /var → /private/var on macOS).
      const resolved = path.join(Instance.directory, relative)
      await FileTime.read(sessionID, resolved)
      await def.executeAsync({ filePath: relative, oldString: "before", newString: "after" }, ctx)
    })
    expect(await fs.readFile(absolute, "utf-8")).toBe("after\n")
  })
})
