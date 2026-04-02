import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { mkdtemp, rm } from "fs/promises"
import os from "os"
import path from "path"
import { Instance } from "../../src/project/instance"
import { chunkText, type RagChunk } from "../../src/rag/chunk"
import { Rag } from "../../src/rag"
import { RagStorage } from "../../src/rag/storage"

let tempDir = ""

function makeVector(dimensions: number, seed: number) {
  return Array.from({ length: dimensions }, (_, index) => ((seed * 31 + index * 17) % 97) / 97)
}

function cosineSimilarity(a: number[], b: number[]) {
  let dot = 0
  let magA = 0
  let magB = 0
  const length = Math.min(a.length, b.length)
  for (let index = 0; index < length; index++) {
    const left = a[index]
    const right = b[index]
    dot += left * right
    magA += left * left
    magB += right * right
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB))
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

function buildChunks(count: number, file: string): RagChunk[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `chunk_${index}`,
    file,
    start: index * 20 + 1,
    end: index * 20 + 20,
    text: `export function example${index}() { return ${index}; }`,
  }))
}

beforeAll(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "nikcli-rag-bench-"))
})

afterAll(async () => {
  await Instance.disposeAll()
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true })
  }
})

describe("RAG Benchmarks", () => {
  it("benchmarks chunkText across small and medium inputs", () => {
    const smallText = Array.from({ length: 120 }, (_, index) => `// line ${index + 1}`).join("\n")
    const mediumText = Array.from({ length: 3000 }, (_, index) => `export const value${index} = ${index}`).join("\n")

    const smallElapsed = measureSync("rag.chunkText() small input", 3000, () => {
      const result = chunkText({
        file: "/tmp/small.ts",
        text: smallText,
        chunkLines: 40,
        maxChunks: 20,
      })
      expect(result.chunks.length).toBe(3)
    })

    const mediumElapsed = measureSync("rag.chunkText() medium input", 300, () => {
      const result = chunkText({
        file: "/tmp/medium.ts",
        text: mediumText,
        chunkLines: 200,
        maxChunks: 30,
      })
      expect(result.chunks.length).toBe(15)
    })

    expect(smallElapsed).toBeGreaterThanOrEqual(0)
    expect(mediumElapsed).toBeGreaterThanOrEqual(0)
  })

  it("benchmarks cosine similarity and local ranking", () => {
    const query = makeVector(256, 1)
    const vectors = Array.from({ length: 200 }, (_, index) => ({
      id: `vec_${index}`,
      vector: makeVector(256, index + 2),
    }))

    const elapsed = measureSync("rag cosine ranking over 200 vectors", 400, () => {
      const ranked = vectors
        .map((item) => ({ id: item.id, score: cosineSimilarity(query, item.vector) }))
        .sort((left, right) => right.score - left.score)
        .slice(0, 8)

      expect(ranked).toHaveLength(8)
      expect(ranked[0].score).toBeGreaterThanOrEqual(ranked[7].score)
    })

    expect(elapsed).toBeGreaterThanOrEqual(0)
  })

  it("benchmarks RagStorage jsonl read and write", async () => {
    await withInstance(async () => {
      const chunks = buildChunks(120, path.join(tempDir, "sample.ts"))
      const vectors = chunks.map((chunk, index) => ({ id: chunk.id, vector: makeVector(64, index + 10) }))
      await RagStorage.ensureDir()

      await measureAsync("rag storage writeJsonl()", 20, async () => {
        await RagStorage.writeJsonl(RagStorage.chunksPath(), chunks)
        await RagStorage.writeJsonl(RagStorage.vectorsPath(), vectors)
      })

      await measureAsync("rag storage readJsonl()", 30, async () => {
        const storedChunks = await RagStorage.readJsonl<RagChunk>(RagStorage.chunksPath())
        const storedVectors = await RagStorage.readJsonl<Array<number>>(RagStorage.vectorsPath())
        expect(storedChunks).toHaveLength(chunks.length)
        expect(storedVectors.length).toBe(vectors.length)
      })
    })
  })

  it("benchmarks Rag.status() and Rag.reset() on a seeded index", async () => {
    await withInstance(async () => {
      await Rag.reset()

      const empty = await Rag.status()
      expect(empty.ready).toBe(false)

      await RagStorage.ensureDir()
      await RagStorage.writeState({
        version: 1,
        model: "text-embedding-3-small",
        files: 12,
        chunks: 120,
        updated: Date.now(),
      })

      await measureAsync("rag status lookup", 60, async () => {
        const status = await Rag.status()
        expect(status.ready).toBe(true)
        expect(status.state?.chunks).toBe(120)
      })

      await measureAsync("rag reset cleanup", 10, async () => {
        await Rag.reset()
        await RagStorage.ensureDir()
        await RagStorage.writeState({
          version: 1,
          model: "text-embedding-3-small",
          files: 1,
          chunks: 4,
          updated: Date.now(),
        })
      })
    })
  })
})
