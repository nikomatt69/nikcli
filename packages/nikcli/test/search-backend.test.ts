import { preserveTestEnv } from "./helpers/env"
import { afterAll, afterEach, describe, expect, it } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { recordBenchmark } from "./benchmarks/runner"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-search-home-"))
process.env.NIKCLI_TEST_HOME = testHome
process.env.NIKCLI_DISABLE_PROJECT_CONFIG = "1"

preserveTestEnv(["NIKCLI_TEST_HOME", "NIKCLI_DISABLE_PROJECT_CONFIG"])

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

// fff builds its index lazily; the first hit may return backend="fff" with stale
// or empty results. Poll until both the backend matches AND we have at least one
// hit (or until expectedHits is reached) so downstream equality checks are stable.
async function waitForFffFiles(
  input: Parameters<typeof SearchBackend.fileList>[0],
  opts: { expectedHits?: number } = {},
) {
  const target = opts.expectedHits ?? 1
  let last = await SearchBackend.fileList({ ...input, prefer: "fff" })
  for (let i = 0; i < 200; i++) {
    if (last.backend === "fff" && last.files.length >= target) return last
    await Bun.sleep(25)
    last = await SearchBackend.fileList({ ...input, prefer: "fff" })
  }
  return last
}

async function waitForFffSearch(
  input: Parameters<typeof SearchBackend.search>[0],
  opts: { expectedHits?: number } = {},
) {
  const target = opts.expectedHits ?? 1
  let last = await SearchBackend.search({ ...input, prefer: "fff" })
  for (let i = 0; i < 200; i++) {
    if (last.backend === "fff" && last.matches.length >= target) return last
    await Bun.sleep(25)
    last = await SearchBackend.search({ ...input, prefer: "fff" })
  }
  return last
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
        const expected = await SearchBackend.fileList({ cwd: projectDir, glob, hidden: false, prefer: "bun" })
        const actual = await waitForFffFiles(
          { cwd: projectDir, glob, hidden: false },
          { expectedHits: expected.files.length },
        )

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
        const expected = await SearchBackend.search({ ...input, prefer: "bun" })
        const actual = await waitForFffSearch(input, { expectedHits: expected.matches.length })

        expect(comparableMatches(actual.matches)).toEqual(comparableMatches(expected.matches))
      },
    )
  })

  it("keeps ripgrep search results compatible with the Bun fallback when rg is installed", async () => {
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
        const actual = await SearchBackend.search({ ...input, prefer: "rg" })
        if (actual.backend !== "rg") {
          // ripgrep not installed in this environment - skip the comparison
          return
        }
        const expected = await SearchBackend.search({ ...input, prefer: "bun" })
        expect(comparableMatches(actual.matches)).toEqual(comparableMatches(expected.matches))
      },
    )
  })

  it("benchmarks fff, ripgrep, and the Bun fallback on the same fixture", async () => {
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

      console.log("\nSearchBackend benchmark (fff vs ripgrep vs Bun)")
      console.log(`  files fff:     ${formatSample(result.files.fff)}`)
      console.log(`  files rg:      ${formatSample(result.files.rg)}`)
      console.log(`  files bun:     ${formatSample(result.files.bun)}`)
      console.log(`  grep fff:      ${formatSample(result.grep.fff)}`)
      console.log(`  grep rg:       ${formatSample(result.grep.rg)}`)
      console.log(`  grep bun:      ${formatSample(result.grep.bun)}`)

      recordBenchmark({
        suite: "search",
        module: "backend",
        scenario: "fff vs ripgrep vs Bun file listing",
        iterations: 40,
        value: result.files.bun.averageMs ?? 0,
        unit: "ms",
        metadata: {
          bunFiles: result.files.bun.count,
          fffAvailable: result.files.fff?.available ?? false,
          rgAvailable: result.files.rg?.available ?? false,
        },
      })

      expect(result.files.bun.available).toBe(true)
      expect(result.grep.bun.available).toBe(true)
      expect(result.grep.bun.count).toBe(40)
      if (result.files.fff) expect(result.files.fff.count).toBe(result.files.bun.count)
      if (result.grep.fff) expect(result.grep.fff.count).toBe(result.grep.bun.count)
      if (result.files.rg) expect(result.files.rg.count).toBe(result.files.bun.count)
      if (result.grep.rg) expect(result.grep.rg.count).toBe(result.grep.bun.count)
    })
  })
})
