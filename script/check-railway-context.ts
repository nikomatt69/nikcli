#!/usr/bin/env bun

export {} // mark as module so top-level await is allowed

/**
 * check-railway-context.ts — guards the Railway upload context.
 *
 * `railway up` from the repo root filters the upload through .railwayignore.
 * Anything Dockerfile.serve COPYs that the filter drops fails the build minutes
 * later with a bare "failed to compute cache key: /packages/<name>: not found",
 * and the CI deploy step runs --detach, so nobody sees it. packages/discord was
 * lost that way and every deploy failed against it for two days.
 *
 * Matching is delegated to `git ls-files -c -i --exclude-from=`, so the rules
 * are evaluated by git's own gitignore implementation rather than a
 * reimplementation of it here. That already caught one live bug: a bare
 * `github` rule, meant for the top-level workspace directory, also matched
 * packages/tui/src/routes/github/ eleven levels down.
 *
 * The sibling hazard is script/railway-deploy.sh, which builds its own context
 * and is checked by its own preflight. This one covers the repo-root path.
 */

import { $ } from "bun"

const DOCKERFILE = "Dockerfile.serve"
const IGNORE_FILE = ".railwayignore"

// Every path Dockerfile.serve COPYs out of the build context. `--from=` stages
// copy between image layers, not from the context.
const required = (await Bun.file(DOCKERFILE).text())
  .split("\n")
  .filter((line) => line.startsWith("COPY ") && !line.includes("--from="))
  .flatMap((line) => line.trim().split(/\s+/).slice(1, -1))
  .filter((src) => src !== "." && !src.startsWith("/"))

const excluded = new Set((await $`git ls-files -c -i --exclude-from=${IGNORE_FILE}`.text()).split("\n").filter(Boolean))

const tracked = (await $`git ls-files -z`.text()).split("\0").filter(Boolean)

const problems: string[] = []
let sawPartial = false

for (const src of [...new Set(required)]) {
  // A COPY source is either a single file or a directory of them.
  const members = tracked.filter((f) => f === src || f.startsWith(`${src}/`))

  if (members.length === 0) {
    problems.push(`${src} — COPYed by ${DOCKERFILE} but not tracked in git`)
    continue
  }

  const dropped = members.filter((f) => excluded.has(f))
  if (dropped.length === members.length) {
    problems.push(`${src} — every file excluded by ${IGNORE_FILE}; the COPY will fail outright`)
  } else if (dropped.length > 0) {
    sawPartial = true
    const sample = dropped.slice(0, 3).join(", ")
    problems.push(
      `${src} — ${dropped.length}/${members.length} files excluded by ${IGNORE_FILE}: ${sample}${dropped.length > 3 ? ", …" : ""}`,
    )
  }
}

if (problems.length > 0) {
  console.error(`✗ ${IGNORE_FILE} drops files that ${DOCKERFILE} needs:`)
  for (const problem of problems) console.error(`    ${problem}`)
  console.error("")
  if (sawPartial) {
    console.error("  A rule matching only some of a package's files is usually an unanchored")
    console.error("  generic name: gitignore matches a bare `github` at every depth, so anchor")
    console.error("  root-only rules with a leading slash (/github).")
  } else {
    console.error(`  A package the image builds must not be excluded at all — drop the rule`)
    console.error(`  covering it, and keep ${IGNORE_FILE} in sync with Dockerfile.serve's stubs.`)
  }
  process.exit(1)
}

console.log(
  `✓ ${IGNORE_FILE} keeps every path ${DOCKERFILE} copies ` +
    `(${tracked.length - excluded.size}/${tracked.length} tracked files uploaded)`,
)
