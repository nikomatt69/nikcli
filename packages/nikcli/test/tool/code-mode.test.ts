import { afterAll, afterEach, describe, expect, it } from "bun:test"
import { Effect } from "effect"
import fs from "fs/promises"
import os from "os"
import path from "path"
import type { Tool as ToolType } from "@/tool/tool"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-code-mode-home-"))
process.env.NIKCLI_TEST_HOME = testHome
process.env.NIKCLI_DISABLE_PROJECT_CONFIG = "1"
process.env.XDG_DATA_HOME = path.join(testHome, "data")
process.env.XDG_CACHE_HOME = path.join(testHome, "cache")
process.env.XDG_CONFIG_HOME = path.join(testHome, "config")
process.env.XDG_STATE_HOME = path.join(testHome, "state")

const { InstanceScope } = await import("@/effect")
const { Instance } = await import("@/project/instance")
const { ToolRegistry } = await import("@/tool/registry")
const { CodeModeTool } = await import("@/tool/code_mode")

const projectDirs: string[] = []

async function makeProjectDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-code-mode-project-"))
  const resolved = await fs.realpath(dir)
  projectDirs.push(resolved)
  return resolved
}

function makeCtx(): ToolType.Context {
  return {
    sessionID: "test-session",
    messageID: "test-message",
    agent: "test",
    abort: new AbortController().signal,
    metadata: () => {},
    ask: async () => {},
  }
}

describe("CodeModeTool", () => {
  it("is registered by default and replaces exec_code", async () => {
    const directory = await makeProjectDir()
    const ids = await Effect.runPromise(
      InstanceScope.with(
        { directory },
        Effect.gen(function* () {
          const registry = yield* ToolRegistry.Service
          return yield* registry.ids()
        }).pipe(Effect.provide(ToolRegistry.defaultLayer)),
      ),
    )
    expect(ids).toContain("code_mode")
    expect(ids).not.toContain("exec_code")
  })

  it("runs a confined program that chains registry tools", async () => {
    const directory = await makeProjectDir()
    await fs.writeFile(path.join(directory, "a.txt"), "alpha TODO one")
    await fs.writeFile(path.join(directory, "b.txt"), "beta nothing here")

    const result = await Effect.runPromise(
      InstanceScope.with(
        { directory },
        Effect.promise(async () => {
          const def = await CodeModeTool.init()
          expect(def.description).toContain("Available tools:")
          expect(def.description).not.toContain("code_mode,")
          return def.executeAsync(
            {
              code: `
                const listing = await tools.glob({ pattern: "*.txt" })
                const files = listing.split("\\n").filter((line) => line.endsWith(".txt"))
                const hits = []
                for (const file of files) {
                  const content = await tools.read({ filePath: file })
                  if (content.includes("TODO")) hits.push(file)
                }
                return { count: hits.length, hits }
              `,
            },
            makeCtx(),
          )
        }),
      ),
    )

    expect(result.output).toContain('"count": 1')
    expect(result.output).toContain("a.txt")
    const toolCalls = result.metadata.toolCalls as { tool: string; status: string }[]
    expect(toolCalls.length).toBeGreaterThanOrEqual(3)
    expect(toolCalls.every((call) => call.status === "completed")).toBe(true)
  })

  it("returns diagnostics for confined-language violations instead of executing them", async () => {
    const directory = await makeProjectDir()
    const failure = await Effect.runPromise(
      InstanceScope.with(
        { directory },
        Effect.promise(async () => {
          const def = await CodeModeTool.init()
          return def.executeAsync({ code: `return process.env` }, makeCtx()).then(
            () => undefined,
            (error: unknown) => error as Error,
          )
        }),
      ),
    )
    expect(failure).toBeInstanceOf(Error)
    expect(failure!.message).toMatch(/process/)
  })
})

afterEach(async () => {
  await Instance.disposeAll().catch(() => undefined)
})

afterAll(async () => {
  await Instance.disposeAll().catch(() => undefined)
  await Promise.all(projectDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })))
  await fs.rm(testHome, { recursive: true, force: true })
})
