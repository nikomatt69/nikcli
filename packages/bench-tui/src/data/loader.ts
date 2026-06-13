import { readdir, readFile } from "fs/promises"
import { existsSync, mkdirSync } from "fs"
import path from "path"
import type { BenchmarkRunFile, BenchmarkRecord, LegacyBenchResult, LoadedRun } from "../types"
import { OUTPUT_DIR, LEGACY_DIR } from "../types"

const LOADER_CACHE_TTL = 30_000
let cache: { data: LoadedRun[]; timestamp: number } | null = null

function legacyResultsToLoaded(results: LegacyBenchResult[], filePath: string, fileName: string): LoadedRun | null {
  if (!Array.isArray(results) || results.length === 0) return null
  const latest = results[results.length - 1]!
  const records: BenchmarkRecord[] = results.map((r) => ({
    runId: latest.date,
    timestamp: r.date,
    suite: "bench",
    module: r.module,
    scenario: r.name,
    iterations: r.iterations,
    value: r.totalMs,
    unit: "ms" as const,
    valuePerIteration: r.perOpMs,
  }))
  return {
    filePath,
    fileName,
    exportedAt: latest.date,
    run: { runId: latest.date, createdAt: latest.date, records },
  }
}

function validateLoadedRun(loaded: LoadedRun, filePath: string): LoadedRun | null {
  if (!loaded.run.runId || !loaded.run.createdAt) {
    console.error(`Invalid run data in ${filePath}: missing runId or createdAt`)
    return null
  }
  if (!Array.isArray(loaded.run.records)) {
    console.error(`Invalid run data in ${filePath}: records is not an array`)
    return null
  }
  loaded.run.records = loaded.run.records.filter((r) => {
    if (!r.suite || !r.scenario || typeof r.value !== "number") {
      console.warn(`Skipping invalid record in ${filePath}`)
      return false
    }
    return true
  })
  return loaded
}

function ensureDir(dirPath: string): void {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true })
  }
}

export async function listNewRuns(): Promise<LoadedRun[]> {
  try {
    ensureDir(OUTPUT_DIR)
    const entries = await readdir(OUTPUT_DIR, { withFileTypes: true })
    const runs: LoadedRun[] = []
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue
      const filePath = path.join(OUTPUT_DIR, entry.name)
      try {
        const content = await readFile(filePath, "utf8")
        const parsed = JSON.parse(content) as BenchmarkRunFile
        if (Array.isArray(parsed)) {
          const legacy = legacyResultsToLoaded(parsed as LegacyBenchResult[], filePath, entry.name)
          if (legacy && validateLoadedRun(legacy, filePath)) runs.push(legacy)
          continue
        }
        if (!parsed.run?.runId || !Array.isArray(parsed.run.records)) continue
        const loaded: LoadedRun = {
          filePath,
          fileName: entry.name,
          exportedAt: parsed.exportedAt ?? parsed.run.createdAt,
          run: parsed.run,
          comparison: parsed.comparison,
        }
        if (validateLoadedRun(loaded, filePath)) runs.push(loaded)
      } catch (parseErr) {
        console.warn(
          `Skipping unparseable file ${entry.name}: ${parseErr instanceof Error ? parseErr.message : parseErr}`,
        )
        continue
      }
    }
    return runs.sort((a, b) => b.exportedAt.localeCompare(a.exportedAt))
  } catch (err) {
    console.warn(`Failed to list runs in ${OUTPUT_DIR}: ${err}`)
    return []
  }
}

export async function listLegacyRuns(): Promise<LoadedRun[]> {
  try {
    ensureDir(LEGACY_DIR)
    const entries = await readdir(LEGACY_DIR, { withFileTypes: true })
    const mapped: LoadedRun[] = []
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue
      try {
        const content = await readFile(path.join(LEGACY_DIR, entry.name), "utf8")
        const results: LegacyBenchResult[] = JSON.parse(content)
        const loaded = legacyResultsToLoaded(results, path.join(LEGACY_DIR, entry.name), entry.name)
        if (loaded && validateLoadedRun(loaded, path.join(LEGACY_DIR, entry.name))) mapped.push(loaded)
      } catch {
        continue
      }
    }
    return mapped.sort((a, b) => b.exportedAt.localeCompare(a.exportedAt))
  } catch {
    return []
  }
}

export async function loadAllRuns({ force } = { force: false }): Promise<LoadedRun[]> {
  if (!force && cache && Date.now() - cache.timestamp < LOADER_CACHE_TTL) {
    return cache.data
  }
  const [newRuns, legacyRuns] = await Promise.all([listNewRuns(), listLegacyRuns()])
  const all = [...newRuns, ...legacyRuns]
  const sorted = all.sort((a, b) => b.exportedAt.localeCompare(a.exportedAt))
  cache = { data: sorted, timestamp: Date.now() }
  return sorted
}

export function clearLoaderCache(): void {
  cache = null
}
