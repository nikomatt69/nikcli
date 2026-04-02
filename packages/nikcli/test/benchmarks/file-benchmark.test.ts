import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "fs/promises"
import os from "os"
import path from "path"
import { FileIgnore } from "../../src/file/ignore"
import { Ripgrep } from "../../src/file/ripgrep"

let tempDir = ""
const createdFiles: string[] = []

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
  tempDir = await mkdtemp(path.join(os.tmpdir(), "nikcli-file-bench-"))

  for (let index = 0; index < 24; index++) {
    const directory = path.join(tempDir, `group-${index % 4}`, `nested-${index % 3}`)
    await mkdir(directory, { recursive: true })
    const extension = index % 3 === 0 ? ".ts" : index % 3 === 1 ? ".json" : ".md"
    const filePath = path.join(directory, `file-${index}${extension}`)
    const content =
      extension === ".json"
        ? JSON.stringify({ id: index, label: `item-${index}`, tags: ["bench", "file"] }, null, 2)
        : `${extension === ".ts" ? "export" : "#"} file ${index}\n${"x".repeat(2048)}`

    await writeFile(filePath, content)
    createdFiles.push(filePath)
  }
})

afterAll(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true })
  }
})

describe("File Benchmarks", () => {
  it("benchmarks FileIgnore.match over mixed paths", () => {
    const inputs = [
      "src/index.ts",
      "node_modules/library/index.js",
      "coverage/report.html",
      "dist/app.js",
      "tmp/output.log",
      "src/components/button.test.ts",
    ]

    const elapsed = measureSync("FileIgnore.match() mixed paths", 30000, () => {
      let ignored = 0
      for (const input of inputs) {
        if (FileIgnore.match(input)) ignored += 1
      }
      expect(ignored).toBeGreaterThan(0)
    })

    expect(elapsed).toBeGreaterThanOrEqual(0)
  })

  it("benchmarks Bun.Glob matching", () => {
    const glob = new Bun.Glob("**/*.ts")
    const inputs = createdFiles.map((file) => path.relative(tempDir, file))

    const elapsed = measureSync("Bun.Glob.match() ts files", 20000, () => {
      const matches = inputs.filter((input) => glob.match(input))
      expect(matches.length).toBeGreaterThan(0)
    })

    expect(elapsed).toBeGreaterThanOrEqual(0)
  })

  it("benchmarks local file reads", async () => {
    const targets = createdFiles.slice(0, 8)

    await measureAsync("Bun.file().text() batch reads", 40, async () => {
      const contents = await Promise.all(targets.map((file) => Bun.file(file).text()))
      expect(contents.every((content) => content.length > 0)).toBe(true)
    })

    await measureAsync("fs.readFile() batch reads", 40, async () => {
      const contents = await Promise.all(targets.map((file) => readFile(file, "utf8")))
      expect(contents.every((content) => content.length > 0)).toBe(true)
    })
  })

  it("benchmarks local file writes", async () => {
    const writeDir = path.join(tempDir, "writes")
    await mkdir(writeDir, { recursive: true })

    await measureAsync("Bun.write() repeated writes", 30, async () => {
      await Promise.all(
        Array.from({ length: 10 }, (_, index) =>
          Bun.write(path.join(writeDir, `bun-${index}.txt`), `bun-write-${index}-${"y".repeat(256)}`),
        ),
      )
    })

    await measureAsync("fs.writeFile() repeated writes", 30, async () => {
      await Promise.all(
        Array.from({ length: 10 }, (_, index) =>
          writeFile(path.join(writeDir, `fs-${index}.txt`), `fs-write-${index}-${"z".repeat(256)}`),
        ),
      )
    })

    const exists = await Bun.file(path.join(writeDir, "bun-0.txt")).exists()
    expect(exists).toBe(true)
  })

  it("benchmarks Ripgrep.files on the generated tree", async () => {
    await measureAsync("Ripgrep.files() generated tree", 20, async () => {
      const files = await Array.fromAsync(Ripgrep.files({ cwd: tempDir, hidden: false, follow: false }))
      // Should find at least the files we created
      expect(files.length).toBeGreaterThanOrEqual(createdFiles.length)
    })
  })

  it("benchmarks stat, split, and JSON parsing workflows", async () => {
    const jsonFile = createdFiles.find((file) => file.endsWith(".json"))
    const textFile = createdFiles.find((file) => file.endsWith(".ts"))
    expect(jsonFile).toBeDefined()
    expect(textFile).toBeDefined()

    await measureAsync("stat + content processing", 60, async () => {
      const info = await stat(textFile!)
      const lines = (await Bun.file(textFile!).text()).split("\n")
      expect(info.size).toBeGreaterThan(0)
      expect(lines.length).toBeGreaterThan(0)
    })

    await measureAsync("JSON.parse() file payload", 80, async () => {
      const parsed = JSON.parse(await Bun.file(jsonFile!).text()) as { id: number }
      expect(typeof parsed.id).toBe("number")
    })
  })
})
