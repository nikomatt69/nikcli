import path from "path"
import ignore from "ignore"
import { Log } from "@/util/log"
import { RagStorage } from "./storage"
import { RagEmbed } from "./embed"
import { chunkText, type RagChunk } from "./chunk"
import { Ripgrep } from "@/file/ripgrep"
import { FileIgnore } from "@/file/ignore"
import { Instance } from "@/project/instance"
import { Config } from "@/config/config"

const VERSION = 1
const DEFAULT_RAG_MODEL = "nvidia/llama-embed-nemotron-8b"
const DEFAULT_RAG_PROVIDER = "nvidia"
const DEFAULT_MAX_FILE_BYTES = 1_000_000

export type RagIndexOptions = {
  paths?: string[]
  chunkLines?: number
  maxFiles?: number
  maxChunks?: number
  maxFileBytes?: number
  model?: string
  provider?: string
}

export type RagSearchOptions = {
  query: string
  limit?: number
  minScore?: number
  provider?: string
}

export type RagSearchResult = {
  file: string
  start: number
  end: number
  score: number
  snippet: string
}

type RagVector = {
  id: string
  vector: number[]
}

type RagFileRecord = {
  file: string
  size: number
  mtime: number
  chunks: string[]
}

export namespace Rag {
  const log = Log.create({ service: "rag" })

  export async function status() {
    const exists = await RagStorage.exists()
    if (!exists) {
      return {
        ready: false,
        path: RagStorage.root(),
      }
    }
    const state = await RagStorage.readState()
    return {
      ready: true,
      path: RagStorage.root(),
      state,
    }
  }

  export async function reset() {
    await RagStorage.reset()
    return {
      path: RagStorage.root(),
    }
  }

  export async function index(options: RagIndexOptions) {
    const state = await Config.state()
    const existingState = await RagStorage.readState()
    const config = state.config
    const model = options.model ?? config.rag?.model ?? existingState?.model ?? DEFAULT_RAG_MODEL
    const provider = options.provider ?? config.rag?.provider ?? DEFAULT_RAG_PROVIDER
    const chunkLines = options.chunkLines ?? 200
    const maxFiles = options.maxFiles ?? 200
    const maxChunks = options.maxChunks ?? 5000
    const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES
    const roots = options.paths?.length ? options.paths : [Instance.directory]
    const resolved = roots.map((item) => (path.isAbsolute(item) ? item : path.resolve(Instance.directory, item)))
    const root = await RagStorage.ensureDir()

    const ignored = await buildIgnoreMatcher()
    const files = await collectFiles(resolved, { maxFiles, maxFileBytes, ignored })
    const existingFiles = await RagStorage.readJsonl<RagFileRecord>(RagStorage.filesPath())
    const existingChunks = await RagStorage.readJsonl<RagChunk>(RagStorage.chunksPath())
    const existingVectors = await RagStorage.readJsonl<RagVector>(RagStorage.vectorsPath())
    const fileMap = new Map(existingFiles.map((item) => [item.file, item]))
    const chunkMap = new Map(existingChunks.map((item) => [item.id, item]))
    const vectorMap = new Map(existingVectors.map((item) => [item.id, item]))

    const nextChunks: RagChunk[] = []
    const nextVectors: RagVector[] = []
    const nextFiles: RagFileRecord[] = []
    const newChunks: RagChunk[] = []
    const newTexts: string[] = []
    const counts = {
      kept: 0,
      skipped: 0,
    }

    for (const file of files) {
      const existing = fileMap.get(file.file)
      const unchanged = existing && existing.size === file.size && existing.mtime === file.mtime
      if (unchanged) {
        counts.kept += 1
        nextFiles.push(existing)
        for (const id of existing.chunks) {
          const chunk = chunkMap.get(id)
          const vector = vectorMap.get(id)
          if (chunk && vector) {
            nextChunks.push(chunk)
            nextVectors.push(vector)
          }
        }
        continue
      }

      const remaining = maxChunks - nextChunks.length - newChunks.length
      if (remaining <= 0) break

      const text = await Bun.file(file.file)
        .text()
        .catch(() => "")
      if (!text) {
        counts.skipped += 1
        continue
      }

      const result = chunkText({
        file: file.file,
        text,
        chunkLines,
        maxChunks: remaining,
      })
      if (result.chunks.length === 0) {
        counts.skipped += 1
        continue
      }
      newChunks.push(...result.chunks)
      newTexts.push(...result.chunks.map((chunk) => chunk.text))
      nextFiles.push({
        file: file.file,
        size: file.size,
        mtime: file.mtime,
        chunks: result.chunks.map((chunk) => chunk.id),
      })
    }

    if (newChunks.length > 0) {
      log.info("embedding", { chunks: newChunks.length, model, provider })
      const embeddings = await RagEmbed.embedAll(newTexts, model, provider)
      const embedded = newChunks.map((chunk, index) => ({ id: chunk.id, vector: embeddings[index] }))
      nextChunks.push(...newChunks)
      nextVectors.push(...embedded)
    }

    await RagStorage.writeJsonl(RagStorage.filesPath(), nextFiles)
    await RagStorage.writeJsonl(RagStorage.chunksPath(), nextChunks)
    await RagStorage.writeJsonl(RagStorage.vectorsPath(), nextVectors)
    await RagStorage.writeState({
      version: VERSION,
      model,
      files: nextFiles.length,
      chunks: nextChunks.length,
      updated: Date.now(),
    })

    return {
      path: root,
      files: nextFiles.length,
      chunks: nextChunks.length,
      model,
      indexed: newChunks.length,
      kept: counts.kept,
      skipped: counts.skipped,
    }
  }

  export async function search(options: RagSearchOptions) {
    const ready = await RagStorage.exists()
    if (!ready) {
      return {
        ready: false,
        results: [] as RagSearchResult[],
      }
    }
    const config = (await Config.state()).config
    const state = await RagStorage.readState()
    const limit = options.limit ?? 8
    const minScore = options.minScore ?? 0.2
    const model = state?.model ?? config.rag?.model ?? DEFAULT_RAG_MODEL
    const provider = options.provider ?? config.rag?.provider

    const chunks = await RagStorage.readJsonl<RagChunk>(RagStorage.chunksPath())
    const vectors = await RagStorage.readJsonl<RagVector>(RagStorage.vectorsPath())
    const map = new Map(vectors.map((item) => [item.id, item.vector]))
    const queryVector = await RagEmbed.embedAll([options.query], model, provider)
    const base = queryVector[0]
    if (!base) {
      return {
        ready: true,
        results: [] as RagSearchResult[],
      }
    }

    const scored = chunks
      .map((chunk) => {
        const vector = map.get(chunk.id)
        if (!vector) return undefined
        const score = cosineSimilarity(base, vector)
        return {
          chunk,
          score,
        }
      })
      .filter((item): item is { chunk: RagChunk; score: number } => Boolean(item))
      .filter((item) => item.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((item) => {
        const snippet = item.chunk.text.replace(/\s+/g, " ").trim().slice(0, 240)
        return {
          file: item.chunk.file,
          start: item.chunk.start,
          end: item.chunk.end,
          score: item.score,
          snippet,
        }
      })

    return {
      ready: true,
      results: scored,
    }
  }
}

type CollectedFile = {
  file: string
  size: number
  mtime: number
}

async function collectFiles(
  roots: string[],
  input: { maxFiles: number; maxFileBytes: number; ignored: ReturnType<typeof ignore> },
) {
  const results: CollectedFile[] = []
  for (const root of roots) {
    if (results.length >= input.maxFiles) break
    const info = await Bun.file(root)
      .stat()
      .catch(() => undefined)
    if (!info) continue
    if (info.isFile()) {
      const entry = await collectFile(root, input)
      if (entry) results.push(entry)
      continue
    }
    if (!info.isDirectory()) continue

    for await (const entry of Ripgrep.files({ cwd: root })) {
      if (results.length >= input.maxFiles) break
      const full = path.join(root, entry)
      const item = await collectFile(full, input)
      if (item) results.push(item)
    }
  }
  return results
}

async function collectFile(file: string, input: { maxFileBytes: number; ignored: ReturnType<typeof ignore> }) {
  const relWorktree = path.relative(Instance.worktree === "/" ? Instance.directory : Instance.worktree, file)
  if (relWorktree === ".nikcli" || relWorktree.startsWith(`.nikcli${path.sep}`)) return undefined
  if (input.ignored.ignores(relWorktree)) return undefined
  if (FileIgnore.match(relWorktree)) return undefined
  if (shouldSkip(file)) return undefined

  const stat = await Bun.file(file)
    .stat()
    .catch(() => undefined)
  if (!stat || !stat.isFile()) return undefined
  if (stat.size > input.maxFileBytes) return undefined

  return {
    file,
    size: stat.size,
    mtime: stat.mtime.getTime(),
  }
}

async function buildIgnoreMatcher() {
  const ig = ignore()
  const base = Instance.worktree === "/" ? Instance.directory : Instance.worktree
  const gitignore = Bun.file(path.join(base, ".gitignore"))
  if (await gitignore.exists()) {
    ig.add(await gitignore.text())
  }
  const ignoreFile = Bun.file(path.join(base, ".ignore"))
  if (await ignoreFile.exists()) {
    ig.add(await ignoreFile.text())
  }
  return ig
}

function cosineSimilarity(a: number[], b: number[]) {
  const length = Math.min(a.length, b.length)
  const dot = Array.from({ length }, (_, index) => a[index] * b[index]).reduce((sum, value) => sum + value, 0)
  const magA = Math.sqrt(a.slice(0, length).reduce((sum, value) => sum + value * value, 0))
  const magB = Math.sqrt(b.slice(0, length).reduce((sum, value) => sum + value * value, 0))
  if (magA === 0 || magB === 0) return 0
  return dot / (magA * magB)
}

const BLOCKED_EXTENSIONS = new Set([
  ".zip",
  ".tar",
  ".gz",
  ".exe",
  ".dll",
  ".so",
  ".class",
  ".jar",
  ".war",
  ".7z",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
  ".odt",
  ".ods",
  ".odp",
  ".bin",
  ".dat",
  ".obj",
  ".o",
  ".a",
  ".lib",
  ".wasm",
  ".pyc",
  ".pyo",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".bmp",
  ".ico",
  ".pdf",
])

function shouldSkip(filepath: string) {
  const ext = path.extname(filepath).toLowerCase()
  return BLOCKED_EXTENSIONS.has(ext)
}
