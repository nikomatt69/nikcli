import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { BatchTool } from "@/tool/batch"
import { Instance } from "@/project/instance"
import { makeToolContext, withProjectDirectory } from "../helpers/tool-context"

describe("BatchTool", () => {
  let projectDir: string
  let testHome: string
  let def: Awaited<ReturnType<typeof BatchTool.init>>
  const previousHome = process.env.NIKCLI_TEST_HOME
  const previousDisable = process.env.NIKCLI_DISABLE_PROJECT_CONFIG

  beforeAll(async () => {
    testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-batch-home-"))
    process.env.NIKCLI_TEST_HOME = testHome
    process.env.NIKCLI_DISABLE_PROJECT_CONFIG = "1"
    projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-batch-proj-"))
    def = await withProjectDirectory(projectDir, () => BatchTool.init())
  })

  afterAll(async () => {
    await Instance.disposeAll().catch(() => undefined)
    if (previousHome === undefined) delete process.env.NIKCLI_TEST_HOME
    else process.env.NIKCLI_TEST_HOME = previousHome
    if (previousDisable === undefined) delete process.env.NIKCLI_DISABLE_PROJECT_CONFIG
    else process.env.NIKCLI_DISABLE_PROJECT_CONFIG = previousDisable
    await fs.rm(projectDir, { recursive: true, force: true }).catch(() => {})
    await fs.rm(testHome, { recursive: true, force: true }).catch(() => {})
  })

  it("rejects an empty tool_calls array at validation time", async () => {
    expect(() => def.parameters.parse({ tool_calls: [] })).toThrow()
  })

  it("formatValidationError mentions the expected payload shape", () => {
    try {
      def.parameters.parse({ tool_calls: [] })
      expect.unreachable("expected parse to throw")
    } catch (error) {
      // SAFETY: `error` is whatever the parse above threw, and
      // `formatValidationError` accepts the validation error of its own
      // parser — `never` is how the tool contract spells that opaque input.
      const formatted = def.formatValidationError?.(error as never)
      expect(formatted).toContain("Invalid parameters for tool 'batch'")
      expect(formatted).toContain("Expected payload format")
    }
  })

  it("reports nested batch as a failed call without throwing", async () => {
    const { ctx } = makeToolContext()
    const result = await withProjectDirectory(projectDir, () =>
      def.executeAsync(
        {
          tool_calls: [{ tool: "batch", parameters: { tool_calls: [{ tool: "read", parameters: {} }] } }],
        },
        ctx,
      ),
    )
    expect(result.metadata.failed).toBe(1)
    expect(result.metadata.successful).toBe(0)
    expect(result.output).toContain("1 failed")
    expect(result.metadata.details?.[0]).toMatchObject({ tool: "batch", success: false })
  })

  it("reports unknown tools as failed calls", async () => {
    const { ctx } = makeToolContext()
    const result = await withProjectDirectory(projectDir, () =>
      def.executeAsync(
        {
          tool_calls: [{ tool: "definitely_not_a_tool", parameters: {} }],
        },
        ctx,
      ),
    )
    expect(result.metadata.failed).toBe(1)
    expect(result.output).toContain("1 failed")
  })

  it("runs a real registry tool (read) in a one-call batch", async () => {
    const filePath = path.join(projectDir, "batch-read.txt")
    await fs.writeFile(filePath, "batch-content\n")
    const { ctx } = makeToolContext()
    const result = await withProjectDirectory(projectDir, () =>
      def.executeAsync(
        {
          tool_calls: [{ tool: "read", parameters: { filePath } }],
        },
        ctx,
      ),
    )
    expect(result.metadata.successful).toBe(1)
    expect(result.metadata.failed).toBe(0)
    expect(result.output).toContain("successfully")
  })
})
