/**
 * Node (non-Bun) runtime stub for the `#fff` import condition.
 *
 * Mirrors the type surface of `fff.bun.ts` so callers type-check identically,
 * but reports `available() === false` and never imports the native binary.
 * The `import type` re-exports below are fully erased at runtime, so loading
 * the file module under Node never reaches `@ff-labs/fff-bun`.
 */
export type {
  DirSearchOptions,
  DirSearchResult,
  GrepCursor,
  GrepMatch,
  GrepMode,
  GrepOptions,
  GrepResult,
  InitOptions,
  MixedSearchResult,
  Result,
  SearchOptions,
  SearchResult,
} from "@ff-labs/fff-bun"

import type {
  DirSearchOptions,
  DirSearchResult,
  GrepOptions,
  GrepResult,
  InitOptions,
  MixedSearchResult,
  Result,
  SearchOptions,
  SearchResult,
} from "@ff-labs/fff-bun"

export type Init = InitOptions

/** Options for the constraint-only `glob` search. Not re-exported by the package root, so declared locally. */
export interface GlobOptions {
  maxThreads?: number
  currentFile?: string
  pageIndex?: number
  pageSize?: number
}

export interface Picker {
  destroy(): void
  isScanning(): boolean
  waitForScan(timeoutMs?: number): Promise<Result<boolean>>
  waitForScanBlocking(timeoutMs?: number): Result<boolean>
  refreshGitStatus(): Result<number>
  fileSearch(query: string, opts?: SearchOptions): Result<SearchResult>
  glob(pattern: string, opts?: GlobOptions): Result<SearchResult>
  directorySearch(query: string, opts?: DirSearchOptions): Result<DirSearchResult>
  mixedSearch(query: string, opts?: SearchOptions): Result<MixedSearchResult>
  grep(query: string, opts?: GrepOptions): Result<GrepResult>
  trackQuery(query: string, file: string): Result<boolean>
  getHistoricalQuery(offset: number): Result<string | null>
}

export function available(): boolean {
  return false
}

export function create(_opts: Init): Result<Picker> {
  return { ok: false, error: "fff unavailable on node runtime" }
}

export * as Fff from "./fff.node"
