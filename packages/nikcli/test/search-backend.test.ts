import { afterAll, afterEach, describe, expect, it } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-search-home-"))
process.env.NIKCLI_TEST_HOME = testHome
process.env.NIKCLI_DISABLE_PROJECT_CONFIG = "1"

const [{ Instance }, { SearchBackend }] = await Promise.all([
  import("../src/project/instance"),
  import("../src/file/searchBackend"),
])

const projectDirs: string[] = []

async function writeFile(root: string, filePath: string, content: string) {
  const absolute = path.join(root, filePath)
  await fs.mkdir(path.dirname(absolute), { recursive: true })
  await Bun.write(absolute, content)
}

async function withProject<T>(files: Record<string, string>, fn: (projectDir: string) => Promise<T>): Promise<T> {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-search-project-"))
  projectDirs.push(projectDir)
  for (const [filePath, content] of Object.entries(files)) {
    await writeFile(projectDir, filePath, content)
  }
  return Instance.provide({
    directory: projectDir,
    fn: () => fn(projectDir),
  })
}

type SearchMatch = Awaited<ReturnType<typeof SearchBackend.search>>["matches"][number]
type BenchmarkSample = Awaited<ReturnType<typeof SearchBackend.benchmark>>["files"]["bun"]

async function waitForFffFiles(input: Parameters<typeof SearchBackend.fileList>[0]) {
  for (let i = 0; i < 40; i++) {
    const result = await SearchBackend.fileList({ ...input, prefer: "fff" })
    if (result.backend === "fff") return result
    await Bun.sleep(25)
  }
  return SearchBackend.fileList({ ...input, prefer: "fff" })
}

async function waitForFffSearch(input: Parameters<typeof SearchBackend.search>[0]) {
  for (let i = 0; i < 40; i++) {
    const result = await SearchBackend.search({ ...input, prefer: "fff" })
    if (result.backend === "fff") return result
    await Bun.sleep(25)
  }
  return SearchBackend.search({ ...input, prefer: "fff" })
}

function comparableMatches(matches: SearchMatch[]) {
  return matches
    .map((match) => ({
      path: match.path.text,
      line: match.line_number,
      text: match.lines.text.trim(),
    }))
    .toSorted((a, b) => `${a.path}:${a.line}`.localeCompare(`${b.path}:${b.line}`))
}

function formatSample(sample: BenchmarkSample | undefined) {
  if (!sample?.available) return "unavailable"
  return `${sample.averageMs.toFixed(2)}ms avg (${sample.count} results)`
}

afterEach(async () => {
  await Instance.disposeAll().catch(() => undefined)
})

afterAll(async () => {
  await Instance.disposeAll().catch(() => undefined)
  await Promise.all(projectDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })))
  await fs.rm(testHome, { recursive: true, force: true })
})

describe("SearchBackend", () => {
  it("keeps fff file listing compatible with the Bun fallback", async () => {
    await withProject(
      {
        "src/alpha.ts": "export const alpha = 'needleOne'\n",
        "src/beta.js": "console.log('needleTwo')\n",
        "src/nested/gamma.ts": "export const gamma = 'needleThree'\n",
        ".hidden/config.ts": "export const hidden = true\n",
        "docs/readme.md": "needle docs\n",
      },
      async (projectDir) => {
        const glob = ["**/*.ts"]
        const actual = await waitForFffFiles({ cwd: projectDir, glob, hidden: false })
        const expected = await SearchBackend.fileList({ cwd: projectDir, glob, hidden: false, prefer: "bun" })

        expect(actual.files.toSorted()).toEqual(expected.files.toSorted())
      },
    )
  })

  it("keeps fff regex search results compatible with the Bun fallback", async () => {
    await withProject(
      {
        "src/alpha.ts": "const value = 'needleOne'\n",
        "src/beta.js": "const value = 'needleTwo'\n",
        "src/nested/gamma.ts": "const value = 'needleThree'\n",
      },
      async (projectDir) => {
        const input = {
          cwd: projectDir,
          pattern: "needle\\w+",
          glob: ["**/*.ts"],
        }
        const actual = await waitForFffSearch(input)
        const expected = await SearchBackend.search({ ...input, prefer: "bun" })

        expect(comparableMatches(actual.matches)).toEqual(comparableMatches(expected.matches))
      },
    )
  })

  it("benchmarks fff and the Bun fallback on the same fixture", async () => {
    const files: Record<string, string> = {}
    for (let index = 0; index < 40; index++) {
      files[`src/file-${index}.ts`] = `export const value${index} = "needle-${index}"\n`
    }
    for (let index = 0; index < 10; index++) {
      files[`docs/doc-${index}.md`] = `needle-${index}\n`
    }

    await withProject(files, async (projectDir) => {
      const result = await SearchBackend.benchmark({
        cwd: projectDir,
        pattern: "needle-",
        glob: ["**/*.ts"],
        rounds: 3,
      })

      console.log("\nSearchBackend benchmark (fff vs Bun fallback)")
      console.log(`  files fff:     ${formatSample(result.files.fff)}`)
      console.log(`  files bun:     ${formatSample(result.files.bun)}`)
      console.log(`  grep fff:      ${formatSample(result.grep.fff)}`)
      console.log(`  grep bun:      ${formatSample(result.grep.bun)}`)

      expect(result.files.bun.available).toBe(true)
      expect(result.grep.bun.available).toBe(true)
      expect(result.grep.bun.count).toBe(40)
      if (result.files.fff) expect(result.files.fff.count).toBe(result.files.bun.count)
      if (result.grep.fff) expect(result.grep.fff.count).toBe(result.grep.bun.count)
    })
  })
})
