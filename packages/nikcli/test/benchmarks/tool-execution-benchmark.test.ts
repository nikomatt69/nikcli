import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { mkdtemp, mkdir, rm, writeFile } from "fs/promises"
import os from "os"
import path from "path"
import z from "zod"
import { Instance } from "../../src/project/instance"
import { ReadTool } from "../../src/tool/read"
import { GlobTool } from "../../src/tool/glob"
import { Tool } from "../../src/tool/tool"

let tempDir = ""
let sampleFile = ""
let globDir = ""

function createContext(): Tool.Context {
  return {
    sessionID: "bench-session",
    messageID: "bench-message",
    agent: "benchmark-agent",
    abort: new AbortController().signal,
    extra: {
      bypassCwdCheck: true,
    },
    metadata() {},
    async ask() {},
  }
}

function measureSync(name: string, iterations: number, fn: () => void) {
  const start = performance.now()
  for (let i = 0; i < iterations; i++) fn()
  const elapsed = performance.now() - start
  const opsPerSecond = Math.round(iterations / (elapsed / 1000))
  console.log(`\n📊 ${name}:`)
  console.log(`   Iterations: ${iterations.toLocaleString()}`)
  console.log(`   Total time: ${elapsed.toFixed(2)}ms`)
  console.log(`   Throughput: ${opsPerSecond.toLocaleString()} ops/sec`)
  return elapsed
}

async function measureAsync(name: string, iterations: number, fn: () => Promise<void>) {
  const start = performance.now()
  for (let i = 0; i < iterations; i++) {
    await fn()
  }
  const elapsed = performance.now() - start
  const opsPerSecond = Math.round(iterations / (elapsed / 1000))
  console.log(`\n📊 ${name}:`)
  console.log(`   Iterations: ${iterations.toLocaleString()}`)
  console.log(`   Total time: ${elapsed.toFixed(2)}ms`)
  console.log(`   Throughput: ${opsPerSecond.toLocaleString()} ops/sec`)
  return elapsed
}

async function withInstance<T>(fn: () => Promise<T> | T): Promise<T> {
  return Instance.provide({
    directory: tempDir,
    fn,
  })
}

beforeAll(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "nikcli-tool-exec-"))
  sampleFile = path.join(tempDir, "sample.ts")
  globDir = path.join(tempDir, "glob")

  await mkdir(globDir, { recursive: true })
  await writeFile(
    sampleFile,
    Array.from({ length: 120 }, (_, index) => `${index + 1}: export const line${index} = ${index}`).join("\n"),
  )

  for (let index = 0; index < 12; index++) {
    await writeFile(path.join(globDir, `file-${index}.ts`), `export const value${index} = ${index}`)
  }
  for (let index = 0; index < 6; index++) {
    await writeFile(path.join(globDir, `doc-${index}.md`), `# Doc ${index}`)
  }
})

afterAll(async () => {
  await Instance.disposeAll()
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true })
  }
})

describe("Tool Execution Benchmarks", () => {
  it("benchmarks ReadTool execution", async () => {
    const read = await ReadTool.init()
    const ctx = createContext()

    await withInstance(async () => {
      await measureAsync("ReadTool.execute() full file", 40, async () => {
        const result = await read.execute({ filePath: sampleFile }, ctx)
        expect(result.output).toContain("<file>")
        expect(result.metadata.preview).toBeDefined()
      })

      await measureAsync("ReadTool.execute() slice with offset", 40, async () => {
        const result = await read.execute({ filePath: sampleFile, offset: 50, limit: 20 }, ctx)
        expect(result.output).toContain("50:")
      })
    })
  })

  it("benchmarks GlobTool execution", async () => {
    const glob = await GlobTool.init()
    const ctx = createContext()

    await withInstance(async () => {
      await measureAsync("GlobTool.execute() ts pattern", 30, async () => {
        const result = await glob.execute({ pattern: "**/*.ts", path: globDir }, ctx)
        expect(result.metadata.count).toBe(12)
      })

      await measureAsync("GlobTool.execute() markdown pattern", 30, async () => {
        const result = await glob.execute({ pattern: "**/*.md", path: globDir }, ctx)
        expect(result.output).toContain(".md")
      })
    })
  })

  it("benchmarks parameter parsing for read and glob tools", async () => {
    const read = await ReadTool.init()
    const glob = await GlobTool.init()

    const readElapsed = measureSync("ReadTool parameters safeParse()", 5000, () => {
      const result = read.parameters.safeParse({
        filePath: sampleFile,
        offset: "10",
        limit: "15",
      })
      expect(result.success).toBe(true)
    })

    const globElapsed = measureSync("GlobTool parameters safeParse()", 5000, () => {
      const result = glob.parameters.safeParse({
        pattern: "**/*.ts",
        path: globDir,
      })
      expect(result.success).toBe(true)
    })

    expect(readElapsed).toBeGreaterThanOrEqual(0)
    expect(globElapsed).toBeGreaterThanOrEqual(0)
  })

  it("benchmarks validation failures and error formatting", async () => {
    const read = await ReadTool.init()
    let errorCount = 0

    await measureAsync("ReadTool invalid parameter handling", 200, async () => {
      const result = read.parameters.safeParse({
        filePath: 42,
      })
      if (!result.success) {
        errorCount += 1
        expect(result.error.issues.length).toBeGreaterThan(0)
      }
    })

    expect(errorCount).toBe(200)
  })

  it("benchmarks Tool.define() and init() on local tools", async () => {
    const elapsed = await measureAsync("Tool.define() + init()", 200, async () => {
      const tool = Tool.define(`bench-tool-${Math.random().toString(36).slice(2)}`, {
        description: "benchmark tool",
        parameters: z.object({ value: z.string() }),
        async execute(args) {
          return {
            title: "benchmark",
            metadata: {},
            output: args.value,
          }
        },
      })

      const initialized = await tool.init()
      const result = await initialized.execute({ value: "ok" }, createContext())
      expect(result.output).toBe("ok")
    })

    expect(elapsed).toBeGreaterThanOrEqual(0)
  })
})
