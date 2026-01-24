import path from "path"
import fs from "fs/promises"
import { Instance } from "@/project/instance"
import { Filesystem } from "@/util/filesystem"

export type RagState = {
  version: number
  model: string
  files: number
  chunks: number
  updated: number
}

export namespace RagStorage {
  export function root() {
    const base = Instance.worktree === "/" ? Instance.directory : Instance.worktree
    return path.join(base, ".nikcli", "rag")
  }

  export function statePath() {
    return path.join(root(), "state.json")
  }

  export function chunksPath() {
    return path.join(root(), "chunks.jsonl")
  }

  export function vectorsPath() {
    return path.join(root(), "vectors.jsonl")
  }

  export function filesPath() {
    return path.join(root(), "files.jsonl")
  }

  export async function ensureDir() {
    const dir = root()
    await fs.mkdir(dir, { recursive: true })
    return dir
  }

  export async function exists() {
    return Filesystem.isDir(root())
  }

  export async function readState() {
    const file = Bun.file(statePath())
    const data = await file.json().catch(() => undefined)
    return data as RagState | undefined
  }

  export async function writeState(state: RagState) {
    await Bun.write(statePath(), JSON.stringify(state, null, 2))
  }

  export async function readJsonl<T>(filepath: string) {
    const text = await Bun.file(filepath)
      .text()
      .catch(() => "")
    if (!text.trim()) return [] as T[]
    return text
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as T)
  }

  export async function writeJsonl<T>(filepath: string, rows: T[]) {
    const lines = rows.map((row) => JSON.stringify(row))
    await Bun.write(filepath, lines.join("\n"))
  }

  export async function reset() {
    const dir = root()
    await fs.rm(dir, { recursive: true, force: true })
  }
}
