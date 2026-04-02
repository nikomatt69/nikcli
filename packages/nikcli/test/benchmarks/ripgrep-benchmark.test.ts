import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { mkdtemp, mkdir, rm, writeFile } from "fs/promises"
import os from "os"
import path from "path"
import { FileIgnore } from "../../src/file/ignore"
import { Ripgrep } from "../../src/file/ripgrep"

let tempDir = ""

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

beforeAll(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "nikcli-rg-bench-"))

  const files = {
    "alpha.ts": [
      'import { z } from "zod"',
      "export interface Config { value: string }",
      'export async function loadConfig() { return { value: "ok" } }',
    ].join("\n"),
    "beta.ts": [
      "export const VERSION = '1.0.0'",
      "export class ExampleService {}",
      "type ExampleState = 'idle' | 'running'",
    ].join("\n"),
    "notes.md": "# Notes\nThis file mentions export and import but is markdown.",
  }

  for (const [name, content] of Object.entries(files)) {
    await writeFile(path.join(tempDir, name), content)
  }

  const nestedDir = path.join(tempDir, "nested")
  await mkdir(nestedDir, { recursive: true })
  for (let index = 0; index < 8; index++) {
    await writeFile(
      path.join(nestedDir, `module-${index}.ts`),
      [`export const item${index} = ${index}`, `async function task${index}() { return ${index} }`].join("\n"),
    )
  }
})

afterAll(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true })
  }
})

describe("Ripgrep Benchmarks", () => {
  it("benchmarks Ripgrep.search on the generated tree", async () => {
    await measureAsync("Ripgrep.search() keyword", 30, async () => {
      const results = await Ripgrep.search({ cwd: tempDir, pattern: "export" })
      expect(results.length).toBeGreaterThan(0)
      expect(results.some((result) => result.lines.text.includes("export"))).toBe(true)
    })

    await measureAsync("Ripgrep.search() with glob filter", 30, async () => {
      const results = await Ripgrep.search({ cwd: tempDir, pattern: "async", glob: ["**/*.ts"] })
      expect(results.every((result) => result.path.text.endsWith(".ts"))).toBe(true)
    })
  })

  it("benchmarks Ripgrep.files on nested paths", async () => {
    await measureAsync("Ripgrep.files() recursive", 20, async () => {
      const files = await Array.fromAsync(Ripgrep.files({ cwd: tempDir, hidden: false, follow: false }))
      expect(files.length).toBe(11)
    })
  })

  it("benchmarks Ripgrep.Match.parse for JSON rows", () => {
    const row = {
      type: "match" as const,
      data: {
        path: { text: "src/example.ts" },
        lines: { text: "export const example = 1" },
        line_number: 1,
        absolute_offset: 0,
        submatches: [{ match: { text: "export" }, start: 0, end: 6 }],
      },
    }

    const elapsed = measureSync("Ripgrep.Match.parse()", 20000, () => {
      const parsed = Ripgrep.Match.parse(row)
      expect(parsed.data.path.text).toBe("src/example.ts")
    })

    expect(elapsed).toBeGreaterThanOrEqual(0)
  })

  it("benchmarks regex matching overhead used around ripgrep results", () => {
    const lines = [
      "export const foo = 1;",
      "import { bar } from './bar';",
      "async function test() {}",
      "class Example {}",
    ]

    // Compile regexes outside the loop
    const patterns = [new RegExp("export"), new RegExp("import"), new RegExp("async"), new RegExp("class")]

    const elapsed = measureSync("regex test on matched lines", 40000, () => {
      for (const line of lines) {
        for (const pattern of patterns) {
          pattern.test(line)
        }
      }
    })

    expect(elapsed).toBeGreaterThanOrEqual(0)
  })

  it("benchmarks full search plus post-processing workflow", async () => {
    await measureAsync("search + map + filter workflow", 25, async () => {
      const results = await Ripgrep.search({ cwd: tempDir, pattern: "export" })
      const files = results.map((result) => result.path.text).filter((file) => !FileIgnore.match(file))

      expect(files.length).toBeGreaterThan(0)
      expect(new Set(files).size).toBeGreaterThan(0)
    })
  })
})
