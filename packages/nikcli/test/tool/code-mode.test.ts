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

function makeCtx(overrides: Partial<ToolType.Context> = {}): ToolType.Context {
  return {
    sessionID: "test-session",
    messageID: "test-message",
    callID: "test-call",
    agent: "test",
    abort: new AbortController().signal,
    metadata: () => {},
    progress: async () => {},
    ask: async () => {},
    ...overrides,
  }
}

async function executeInProject(
  directory: string,
  input: Parameters<Awaited<ReturnType<typeof CodeModeTool.init>>["executeAsync"]>[0],
  ctx = makeCtx(),
) {
  return Effect.runPromise(
    InstanceScope.with(
      { directory },
      Effect.promise(async () => {
        const def = await CodeModeTool.init()
        return def.executeAsync(input, ctx)
      }),
    ),
  )
}

async function executeFailure(
  directory: string,
  input: Parameters<Awaited<ReturnType<typeof CodeModeTool.init>>["executeAsync"]>[0],
  ctx = makeCtx(),
) {
  return executeInProject(directory, input, ctx).then(
    () => undefined,
    (error: unknown) => error as Error,
  )
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
          expect(def.description).toContain("## Available tools (")
          expect(def.description).toContain("tools.glob(input:")
          expect(def.description).not.toContain("tools.code_mode(input:")
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
    const toolCalls = result.metadata.toolCalls as {
      tool: string
      status: string
    }[]
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

  it("publishes running and completed metadata for nested calls", async () => {
    const directory = await makeProjectDir()
    const filePath = path.join(directory, "progress.txt")
    await fs.writeFile(filePath, "progress")
    const updates: Array<{
      toolCalls?: Array<{ tool: string; status: string }>
    }> = []

    await executeInProject(
      directory,
      { code: `return await tools.read({ filePath: ${JSON.stringify(filePath)} })` },
      makeCtx({
        metadata: ({ metadata }) => updates.push((metadata ?? {}) as (typeof updates)[number]),
      }),
    )

    expect(updates.some((update) => update.toolCalls?.some((call) => call.status === "running"))).toBe(true)
    expect(updates.at(-1)?.toolCalls?.[0]?.status).toBe("completed")
  })

  it("propagates permission denial and marks the nested call as errored", async () => {
    const directory = await makeProjectDir()
    const updates: Array<{
      toolCalls?: Array<{ tool: string; status: string }>
      success?: boolean
    }> = []
    const failure = await executeFailure(
      directory,
      {
        code: `return await tools.bash({ command: "pwd", description: "Print working directory" })`,
      },
      makeCtx({
        ask: async () => {
          throw new Error("rejected permission")
        },
        metadata: ({ metadata }) => updates.push((metadata ?? {}) as (typeof updates)[number]),
      }),
    )

    expect(failure).toBeInstanceOf(Error)
    expect(failure!.message).toContain("rejected permission")
    expect(updates.at(-1)?.success).toBe(false)
    expect(updates.at(-1)?.toolCalls?.[0]?.status).toBe("error")
  })

  it("aborts a running orchestration through the parent tool signal", async () => {
    const directory = await makeProjectDir()
    const controller = new AbortController()
    const failure = await executeFailure(
      directory,
      {
        code: `return await tools.bash({ command: "sleep 10", description: "Wait for cancellation" })`,
      },
      makeCtx({
        abort: controller.signal,
        metadata: ({ metadata }) => {
          const calls = (metadata?.toolCalls ?? []) as Array<{
            status: string
          }>
          if (calls.some((call) => call.status === "running")) controller.abort()
        },
      }),
    )

    expect(failure).toBeInstanceOf(Error)
    expect(failure!.message).toContain("Execution cancelled")
  })

  it("keeps excluded tools outside the confined namespace", async () => {
    const directory = await makeProjectDir()
    const failure = await executeFailure(directory, {
      code: `return await tools.code_mode({ code: "return 1" })`,
    })

    expect(failure).toBeInstanceOf(Error)
    expect(failure!.message).toMatch(/code_mode|Unknown tool/)
  })

  it("enforces maxToolCalls across a multi-tool program", async () => {
    const directory = await makeProjectDir()
    const failure = await executeFailure(directory, {
      code: `
        await tools.glob({ pattern: "*.txt" })
        return await tools.glob({ pattern: "*.md" })
      `,
      maxToolCalls: 1,
    })

    expect(failure).toBeInstanceOf(Error)
    expect(failure!.message).toContain("tool-call limit of 1")
  })

  it("bounds retained result bytes and exposes truncation metadata", async () => {
    const directory = await makeProjectDir()
    const result = await executeInProject(directory, {
      code: `return "x".repeat(512)`,
      maxOutputBytes: 96,
    })

    expect(result.output).toContain("result truncated")
    expect(result.metadata.truncated).toBe(true)
  })

  it("orchestrates independent nested tools concurrently", async () => {
    const directory = await makeProjectDir()
    const left = path.join(directory, "left.txt")
    const right = path.join(directory, "right.txt")
    await Promise.all([fs.writeFile(left, "left"), fs.writeFile(right, "right")])
    const result = await executeInProject(directory, {
      code: `
        const values = await Promise.all([
          tools.read({ filePath: ${JSON.stringify(left)} }),
          tools.read({ filePath: ${JSON.stringify(right)} }),
        ])
        return {
          left: values[0].includes("left"),
          right: values[1].includes("right"),
        }
      `,
      maxToolCalls: 2,
    })

    expect(result.output).toContain('"left": true')
    expect(result.output).toContain('"right": true')
    const calls = result.metadata.toolCalls as Array<{ status: string }>
    expect(calls).toHaveLength(2)
    expect(calls.every((call) => call.status === "completed")).toBe(true)
  })

  it("records a failed nested call when the program recovers", async () => {
    const directory = await makeProjectDir()
    const missing = path.join(directory, "missing.txt")
    const result = await executeInProject(directory, {
      code: `
        try {
          await tools.read({ filePath: ${JSON.stringify(missing)} })
        } catch (error) {
          return "recovered"
        }
      `,
    })

    expect(result.output).toBe("recovered")
    expect((result.metadata.toolCalls as Array<{ status: string }>)[0]?.status).toBe("error")
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
