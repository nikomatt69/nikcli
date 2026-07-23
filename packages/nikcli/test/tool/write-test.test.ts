import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { WriteTool } from "@/tool/write"
import { FileTime } from "@/file/time"
import { Instance } from "@/project/instance"
import { makeToolContext, withProjectDirectory } from "../helpers/tool-context"

describe("WriteTool", () => {
  let projectDir: string
  let def: Awaited<ReturnType<typeof WriteTool.init>>

  beforeAll(async () => {
    projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-write-test-"))
    def = await withProjectDirectory(projectDir, () => WriteTool.init())
  })

  afterAll(async () => {
    await Instance.disposeAll().catch(() => undefined)
    await fs.rm(projectDir, { recursive: true, force: true }).catch(() => {})
  })

  it("writes a new file with the given content", async () => {
    const filePath = path.join(projectDir, "new.txt")
    const { ctx, asked } = makeToolContext()
    const result = await withProjectDirectory(projectDir, () =>
      def.executeAsync({ filePath, content: "hello\n" }, ctx),
    )
    expect(result.output).toContain("Wrote file successfully")
    expect(await fs.readFile(filePath, "utf-8")).toBe("hello\n")
    expect(asked.some((a) => a.permission === "edit")).toBe(true)
  })

  it("overwrites an existing file after FileTime.read", async () => {
    const filePath = path.join(projectDir, "existing.txt")
    await fs.writeFile(filePath, "old\n")
    const { ctx, sessionID } = makeToolContext()
    await withProjectDirectory(projectDir, async () => {
      await FileTime.read(sessionID, filePath)
      await def.executeAsync({ filePath, content: "new\n" }, ctx)
    })
    expect(await fs.readFile(filePath, "utf-8")).toBe("new\n")
  })

  it("preserves CRLF on existing files when input has only LF", async () => {
    const filePath = path.join(projectDir, "crlf.txt")
    await fs.writeFile(filePath, "line1\r\nline2\r\n")
    const { ctx, sessionID } = makeToolContext()
    await withProjectDirectory(projectDir, async () => {
      await FileTime.read(sessionID, filePath)
      await def.executeAsync({ filePath, content: "line1\nline2\n" }, ctx)
    })
    expect(await fs.readFile(filePath, "utf-8")).toBe("line1\r\nline2\r\n")
  })

  it("resolves relative filePath against the Instance directory", async () => {
    const { ctx } = makeToolContext()
    const result = await withProjectDirectory(projectDir, () =>
      def.executeAsync({ filePath: "relative.txt", content: "rel\n" }, ctx),
    )
    expect(result.output).toContain("Wrote file successfully")
    expect(await fs.readFile(path.join(projectDir, "relative.txt"), "utf-8")).toBe("rel\n")
  })

  it("includes the title in the result and metadata", async () => {
    const filePath = path.join(projectDir, "meta.txt")
    const { ctx } = makeToolContext()
    const result = await withProjectDirectory(projectDir, () =>
      def.executeAsync({ filePath, content: "meta\n" }, ctx),
    )
    expect(result.title).toBeTruthy()
    expect(result.metadata).toHaveProperty("filepath")
    expect(result.metadata).toHaveProperty("exists")
  })

  it("rejects overwrite when the file was never read", async () => {
    const filePath = path.join(projectDir, "unread-write.txt")
    await fs.writeFile(filePath, "old\n")
    const { ctx } = makeToolContext()
    await expect(
      withProjectDirectory(projectDir, () => def.executeAsync({ filePath, content: "new\n" }, ctx)),
    ).rejects.toThrow(/must read file/)
  })
})
