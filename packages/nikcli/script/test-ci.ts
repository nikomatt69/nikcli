#!/usr/bin/env bun

export {} // mark as module so top-level await is allowed

/**
 * test-ci.ts — runs the validation test suite in bounded batches.
 *
 * `bun test --parallel=1` puts all 348 files through a single process. Each one
 * builds nikcli instances and SQLite databases whose memory is never returned to
 * the OS, so RSS climbs steadily: CI died at file 175 of 348 with one bun
 * process holding 14.5 GB, MemAvailable at 447 MB and no swap. The runner is
 * then killed, the step exits 143 and the whole job dies — `critical: false` on
 * the step cannot save it, because the runner itself is gone.
 *
 * `--parallel=1` was not the wrong call: it implies `--isolate`, so each file
 * still gets a fresh global and module registry. What it cannot do is hand
 * memory back, because the process never exits. Batching does exactly that —
 * every batch is a short-lived process whose heap the kernel reclaims on exit,
 * which caps peak RSS at roughly batch-size × per-file cost instead of letting
 * it run to the length of the suite.
 *
 * File selection is deliberately not reimplemented here: the ignore patterns are
 * matched with Bun.Glob, the same engine `--path-ignore-patterns` uses. Each
 * batch is then handed explicit file paths, so the ignore flags themselves are
 * redundant and are not forwarded.
 */

import { $ } from "bun"

const IGNORE_PATTERNS = ["**/*benchmark*.test.ts", "**/*integration*.test.ts"]
const TIMEOUT = "30000"

const args = process.argv.slice(2)
const dryRun = args.includes("--dry-run")
const batchSize = Number(args.find((a) => a.startsWith("--batch="))?.split("=")[1] ?? 25)

if (!Number.isInteger(batchSize) || batchSize < 1) {
  console.error(`✗ --batch must be a positive integer, got ${batchSize}`)
  process.exit(1)
}

const ignores = IGNORE_PATTERNS.map((pattern) => new Bun.Glob(pattern))
const all = [...new Bun.Glob("test/**/*.test.{ts,tsx}").scanSync(".")].sort()
const files = all.filter((file) => !ignores.some((glob) => glob.match(file)))

if (files.length === 0) {
  console.error("✗ No test files matched — refusing to report a vacuous pass")
  process.exit(1)
}

const batches: string[][] = []
for (let i = 0; i < files.length; i += batchSize) batches.push(files.slice(i, i + batchSize))

console.log(
  `${files.length} test files (${all.length - files.length} ignored) in ${batches.length} batches of up to ${batchSize}`,
)

if (dryRun) {
  for (const [index, batch] of batches.entries()) {
    console.log(
      `  batch ${index + 1}/${batches.length}: ${batch.length} files  ${batch[0]} … ${batch[batch.length - 1]}`,
    )
  }
  const covered = batches.flat()
  const ok = covered.length === files.length && new Set(covered).size === files.length
  console.log(
    ok ? "✓ batches cover every selected file exactly once" : "✗ batch partition does not match the file list",
  )
  process.exit(ok ? 0 : 1)
}

const failed: number[] = []

for (const [index, batch] of batches.entries()) {
  const label = `batch ${index + 1}/${batches.length} (${batch.length} files)`
  console.log(`\n──── ${label} ────`)

  const result = await $`bun test --smol --timeout ${TIMEOUT} ${batch}`.nothrow()

  if (result.exitCode !== 0) {
    failed.push(index + 1)
    console.log(`✗ ${label} exited ${result.exitCode}`)
  }
}

if (failed.length > 0) {
  console.error(`\n✗ ${failed.length}/${batches.length} batches failed: ${failed.join(", ")}`)
  process.exit(1)
}

console.log(`\n✓ all ${batches.length} batches passed (${files.length} files)`)
