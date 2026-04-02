import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { mkdtemp, mkdir, rm } from "fs/promises"
import os from "os"
import path from "path"
import { randomUUID } from "crypto"
import type { DocEntry } from "../../src/docs/library"

type DocsLibraryModule = typeof import("../../src/docs/library")
type DocsContextModule = typeof import("../../src/docs/context")

let tempRoot = ""
let docsDir = ""
let libraryPath = ""
let contextPath = ""
let docsLibrary: DocsLibraryModule
let docsContext: DocsContextModule

const originalEnv = {
  XDG_DATA_HOME: process.env.XDG_DATA_HOME,
  XDG_CACHE_HOME: process.env.XDG_CACHE_HOME,
  XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
  XDG_STATE_HOME: process.env.XDG_STATE_HOME,
}

function buildDoc(index: number): DocEntry {
  const category = ["api", "cli", "config", "guide"][index % 4]
  const tags = [
    "typescript",
    "async",
    category,
    index % 2 === 0 ? "performance" : "workflow",
  ]

  return {
    id: randomUUID(),
    url: `https://docs.local/${index}`,
    title: `Doc ${index} ${category} reference`,
    category,
    tags,
    addedAt: Date.now() + index,
    content: [
      `# Document ${index}`,
      "",
      `This TypeScript ${category} guide explains async workflows, configuration, and command patterns.`,
      "",
      "## Usage",
      "",
      `Use example${index}() to process input, validate configuration, and return structured output.`,
      "",
      "```ts",
      `export async function example${index}(input: string) {`,
      `  return { ok: true, value: input, category: \"${category}\" }`,
      "}",
      "```",
      "",
      "This document contains enough repeated terminology to exercise search, snippet creation, and context summaries.",
      "TypeScript async configuration command guide performance workflow.",
      "TypeScript async configuration command guide performance workflow.",
    ].join("\n"),
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

async function writeLibrary(docs: DocEntry[]) {
  await mkdir(docsDir, { recursive: true })
  await Bun.write(libraryPath, JSON.stringify(docs, null, 2))
  await Bun.write(contextPath, JSON.stringify({ ids: [], updatedAt: Date.now() }, null, 2))
}

async function seedDocs(count: number) {
  const docs = Array.from({ length: count }, (_, index) => buildDoc(index))
  await writeLibrary(docs)
  return docs
}

beforeAll(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "nikcli-docs-bench-"))
  process.env.XDG_DATA_HOME = path.join(tempRoot, "data")
  process.env.XDG_CACHE_HOME = path.join(tempRoot, "cache")
  process.env.XDG_CONFIG_HOME = path.join(tempRoot, "config")
  process.env.XDG_STATE_HOME = path.join(tempRoot, "state")

  docsDir = path.join(process.env.XDG_DATA_HOME, "nikcli", "docs")
  libraryPath = path.join(docsDir, "library.json")
  contextPath = path.join(docsDir, "context.json")

  docsLibrary = await import("../../src/docs/library")
  docsContext = await import("../../src/docs/context")
})

afterAll(async () => {
  process.env.XDG_DATA_HOME = originalEnv.XDG_DATA_HOME
  process.env.XDG_CACHE_HOME = originalEnv.XDG_CACHE_HOME
  process.env.XDG_CONFIG_HOME = originalEnv.XDG_CONFIG_HOME
  process.env.XDG_STATE_HOME = originalEnv.XDG_STATE_HOME

  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true })
  }
})

describe("Docs Benchmarks", () => {
  it("benchmarks library search across seeded docs", async () => {
    const docs = await seedDocs(200)
    let totalResults = 0

    await measureAsync("docs.searchDocs() keyword search", 120, async () => {
      const results = await docsLibrary.searchDocs("typescript async configuration", undefined, 5)
      totalResults += results.length
      expect(results.length).toBeGreaterThan(0)
      expect(results[0]?.entry.title.length).toBeGreaterThan(0)
    })

    expect(docs).toHaveLength(200)
    expect(totalResults).toBeGreaterThan(0)
  })

  it("benchmarks filtered listing and direct lookup", async () => {
    const docs = await seedDocs(120)
    const first = docs[0]
    expect(first).toBeDefined()

    await measureAsync("docs.listDocs() category filter", 100, async () => {
      const listed = await docsLibrary.listDocs("api")
      expect(listed.length).toBeGreaterThan(0)
    })

    await measureAsync("docs.getDoc() by id/url/title", 90, async () => {
      const byId = await docsLibrary.getDoc(first.id)
      const byUrl = await docsLibrary.getDoc(first.url)
      const byTitle = await docsLibrary.getDoc(first.title)
      expect(byId?.id).toBe(first.id)
      expect(byUrl?.id).toBe(first.id)
      expect(byTitle?.id).toBe(first.id)
    })

    await measureAsync("docs.getDocs() batch lookup", 80, async () => {
      const batch = await docsLibrary.getDocs(docs.slice(0, 12).map((item) => item.id))
      expect(batch).toHaveLength(12)
    })
  })

  it("benchmarks load, unload, and loaded-doc retrieval", async () => {
    const docs = await seedDocs(80)
    const ids = docs.slice(0, 20).map((item) => item.id)

    await measureAsync("docs.loadDocs()", 60, async () => {
      const result = await docsContext.loadDocs(ids)
      expect(result.loaded.length).toBe(20)
      await docsContext.unloadDocs()
    })

    await docsContext.loadDocs(ids)

    await measureAsync("docs.getLoadedDocs()", 120, async () => {
      const loaded = await docsContext.getLoadedDocs()
      expect(loaded).toHaveLength(20)
    })

    await measureAsync("docs.unloadDocs() partial", 60, async () => {
      await docsContext.loadDocs(ids)
      const removed = await docsContext.unloadDocs(ids.slice(0, 5))
      expect(removed.removed).toHaveLength(5)
      await docsContext.unloadDocs()
    })
  })

  it("benchmarks summary and full-context generation", async () => {
    const docs = await seedDocs(40)
    await docsContext.loadDocs(docs.map((item) => item.id))

    await measureAsync("docs.getContextSummary()", 100, async () => {
      const summary = await docsContext.getContextSummary()
      expect(summary).toContain("Documentation context")
    })

    await measureAsync("docs.getFullContext()", 60, async () => {
      const full = await docsContext.getFullContext()
      expect(full).toContain("# DOCUMENTATION CONTEXT")
      expect(full.length).toBeGreaterThan(0)
    })
  })

  it("benchmarks local scoring and snippet helpers used by docs search", async () => {
    const docs = await seedDocs(50)
    const query = "typescript performance workflow"

    const elapsed = measureSync("docs local snippet extraction", 5000, () => {
      const source = docs[10].content
      const lower = source.toLowerCase()
      const idx = lower.indexOf("performance")
      const snippet = source.slice(Math.max(0, idx - 40), Math.min(source.length, idx + 120))
      expect(snippet.length).toBeGreaterThan(0)
    })

    expect(elapsed).toBeGreaterThanOrEqual(0)

    await measureAsync("docs.searchDocs() repeated same query", 80, async () => {
      const results = await docsLibrary.searchDocs(query, undefined, 8)
      expect(results.length).toBeGreaterThanOrEqual(0)
      expect(results[0]?.score).toBeGreaterThan(0)
    })
  })
})
