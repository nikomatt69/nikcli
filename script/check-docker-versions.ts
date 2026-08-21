#!/usr/bin/env bun

export {} // mark as module so top-level await is allowed

/**
 * check-docker-versions.ts — guards the nikcli version stamped into Docker images.
 *
 * Every image that compiles nikcli passes NIKCLI_VERSION to
 * packages/nikcli/script/build.ts, which bakes it into the binary as the version
 * the CLI reports. Two ways to get that wrong, and the repo has hit the first:
 *
 *   1. A literal (`ENV NIKCLI_VERSION=1.216.0`). It goes stale the moment the
 *      next release lands, and nothing fails — the image just lies about what it
 *      is. Both Dockerfile and Dockerfile.serve were pinned to 1.216.0 while the
 *      repo shipped 1.302.0.
 *   2. Unset. build.ts then queries npm for nikcli-ai@latest and stamps
 *      *patch + 1* — the version the next publish will take, which does not
 *      exist yet — and needs a network round trip mid-build to do it.
 *
 * The correct source is packages/nikcli/package.json: `release: vX.Y.Z` rewrites
 * every manifest in the repo before tagging, so it always holds the latest
 * release, and it is already inside the build layer.
 *
 * This check fails on (1). It does not try to prove (2) — a Dockerfile that
 * never builds nikcli has no reason to set the variable at all.
 */

import { $ } from "bun"

const files = await $`git ls-files -z`.text().then((out) =>
  out
    .split("\0")
    .filter(Boolean)
    .filter((f) => /(^|\/)(Dockerfile[^/]*|docker-compose[^/]*\.ya?ml)$/.test(f)),
)

const ASSIGNMENT = /NIKCLI_VERSION[=:]\s*(.+?)\s*$/

// A value is acceptable when it defers to something evaluated at build time:
// a shell expansion, a build arg, or a compose interpolation.
function isDerived(rawValue: string): boolean {
  const value = rawValue.replace(/^["']|["']$/g, "")
  return value.startsWith("$") || value.includes("${") || value.includes("$(")
}

const offenders: string[] = []

for (const file of files) {
  const lines = await Bun.file(file)
    .text()
    .then((t) => t.split("\n"))
  lines.forEach((line, index) => {
    const trimmed = line.trim()
    if (trimmed.startsWith("#")) return
    if (!trimmed.includes("NIKCLI_VERSION")) return

    const match = trimmed.match(ASSIGNMENT)
    if (!match) return

    const value = match[1]!
    // A continuation (`NIKCLI_VERSION="$(...)" \`) hands the value to the next
    // line's command; the expansion is still on this line, so isDerived holds.
    if (isDerived(value)) return

    offenders.push(`${file}:${index + 1}: NIKCLI_VERSION pinned to a literal (${value})`)
  })
}

if (offenders.length > 0) {
  console.error("✗ Docker images must derive the nikcli version, not pin it:")
  for (const offender of offenders) console.error(`    ${offender}`)
  console.error("")
  console.error("  Read it off the manifest already in the build layer instead:")
  console.error(`    NIKCLI_VERSION="$(bun -e 'console.log(require("./package.json").version)')" \\`)
  console.error("        bun run script/build.ts ...")
  process.exit(1)
}

console.log(`✓ ${files.length} Docker/compose files carry no pinned nikcli version`)
