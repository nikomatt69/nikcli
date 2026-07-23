import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { BashTool } from "@/tool/bash"
import { Instance } from "@/project/instance"
import { makeToolContext, withProjectDirectory } from "../helpers/tool-context"

describe("BashTool", () => {
  let projectDir: string
  let def: Awaited<ReturnType<typeof BashTool.init>>

  beforeAll(async () => {
    projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-bash-test-"))
    def = await withProjectDirectory(projectDir, () => BashTool.init())
  })

  afterAll(async () => {
    await Instance.disposeAll().catch(() => undefined)
    await fs.rm(projectDir, { recursive: true, force: true }).catch(() => {})
  })

  it("runs a simple echo command and returns stdout", async () => {
    const { ctx, asked, recordedMetadata } = makeToolContext()
    const result = await withProjectDirectory(projectDir, () =>
      def.executeAsync({ command: "echo hello-nikcli", description: "echo greeting" }, ctx),
    )
    expect(result.title).toBe("echo greeting")
    expect(result.output).toContain("hello-nikcli")
    expect(asked.some((a) => a.permission === "bash")).toBe(true)
    expect(recordedMetadata[0]?.metadata).toMatchObject({
      command: "echo hello-nikcli",
      description: "echo greeting",
      output: "",
    })
  })

  it("synthesizes a title when description is omitted", async () => {
    const { ctx } = makeToolContext()
    const result = await withProjectDirectory(projectDir, () =>
      def.executeAsync({ command: "echo no-desc" }, ctx),
    )
    expect(result.title).toBe("Shell")
    expect(result.output).toContain("no-desc")
  })

  it("honours workdir for the child process", async () => {
    const nested = path.join(projectDir, "nested")
    await fs.mkdir(nested)
    await fs.writeFile(path.join(nested, "marker.txt"), "ok\n")
    const { ctx } = makeToolContext()
    const result = await withProjectDirectory(projectDir, () =>
      def.executeAsync({ command: "ls marker.txt", workdir: nested, description: "list marker" }, ctx),
    )
    expect(result.output).toContain("marker.txt")
  })

  it("rejects a negative timeout before spawn", async () => {
    const { ctx } = makeToolContext()
    await expect(
      withProjectDirectory(projectDir, () => def.executeAsync({ command: "echo x", timeout: -1 }, ctx)),
    ).rejects.toThrow(/Invalid timeout/)
  })

  it("reports timeout metadata when the command exceeds timeout", async () => {
    const { ctx } = makeToolContext()
    const result = await withProjectDirectory(projectDir, () =>
      def.executeAsync({ command: "sleep 2", timeout: 50, description: "sleep briefly" }, ctx),
    )
    expect(result.output).toContain("bash_metadata")
    expect(result.output).toContain("timeout")
  })

  it("propagates non-zero exit output without throwing", async () => {
    const { ctx } = makeToolContext()
    const result = await withProjectDirectory(projectDir, () =>
      def.executeAsync({ command: "sh -c 'echo fail-out; exit 7'", description: "failing cmd" }, ctx),
    )
    expect(result.output).toContain("fail-out")
  })
})
