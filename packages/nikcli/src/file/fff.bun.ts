/**
 * Bun runtime adapter for `@ff-labs/fff-bun` (frecency-backed native FileFinder).
 *
 * Ported from opencode's `packages/core/src/filesystem/fff.bun.ts`: a thin
 * `Picker` adapter over the native `FileFinder` plus a runtime-conditional
 * `#fff` import (see package.json `imports`). The companion `fff.node.ts`
 * exposes the same surface but reports `available() === false`, so importing
 * the file module under a non-Bun runtime never touches the native binary.
 *
 * Unlike opencode this passes the native option/result types straight through
 * so the richer call sites in nikcli (grep `smartCase`, before/after context,
 * `maxMatchesPerFile`, frecency scores) keep their full typing.
 */
import {
  FileFinder,
  type DirSearchOptions,
  type DirSearchResult,
  type GrepCursor,
  type GrepMatch,
  type GrepMode,
  type GrepOptions,
  type GrepResult,
  type InitOptions,
  type MixedSearchResult,
  type Result,
  type SearchOptions,
  type SearchResult,
} from "@ff-labs/fff-bun"

declare global {
  const FFF_LIBC: "gnu" | "musl"
}

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
}

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
  /** Async scan wait (0.9.x). Prefer this off the hot path. */
  waitForScan(timeoutMs?: number): Promise<Result<boolean>>
  /** Synchronous scan wait — drop-in for the pre-0.9 `waitForScan`. */
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
  return FileFinder.isAvailable()
}

export function create(opts: Init): Result<Picker> {
  const made = FileFinder.create(opts)
  if (!made.ok) return made
  const finder = made.value
  return {
    ok: true,
    value: {
      destroy: () => finder.destroy(),
      isScanning: () => finder.isScanning(),
      waitForScan: (timeoutMs) => finder.waitForScan(timeoutMs),
      waitForScanBlocking: (timeoutMs) => finder.waitForScanBlocking(timeoutMs),
      refreshGitStatus: () => finder.refreshGitStatus(),
      fileSearch: (query, next) => finder.fileSearch(query, next),
      glob: (pattern, next) => finder.glob(pattern, next),
      directorySearch: (query, next) => finder.directorySearch(query, next),
      mixedSearch: (query, next) => finder.mixedSearch(query, next),
      grep: (query, next) => finder.grep(query, next),
      trackQuery: (query, file) => finder.trackQuery(query, file),
      getHistoricalQuery: (offset) => finder.getHistoricalQuery(offset),
    },
  }
}

export * as Fff from "./fff.bun"
