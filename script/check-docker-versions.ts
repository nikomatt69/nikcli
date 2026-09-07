#!/usr/bin/env bun

export {} // mark as module so top-level await is allowed

/**
 * check-docker-versions.ts — guards runtime, dependency, and application versions.
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
 * Bun image tags and build-arg defaults must also match root packageManager;
 * positional Effect installs must not change the validated workspace graph.
 */

import { $ } from "bun"
import path from "node:path"

// Accept a fixture root so regression tests can exercise the real CLI.
const root = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(import.meta.dir, "..")
const manifest = await Bun.file(path.join(root, "package.json")).json()
const bunVersion = /^bun@(\d+\.\d+\.\d+)$/.exec(manifest.packageManager ?? "")?.[1]
if (!bunVersion) throw new Error("Root packageManager must pin bun@<major.minor.patch>")
const files = await $`git ls-files -z`
  .cwd(root)
  .text()
  .then((out) =>
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
  const lines = await Bun.file(path.join(root, file))
    .text()
    .then((t) => t.split("\n"))
  lines.forEach((line, index) => {
    const trimmed = line.trim()
    if (trimmed.startsWith("#")) return
    const image = trimmed.match(/^FROM\s+(?:--platform=\S+\s+)?oven\/bun:([^\s@]+)/i)
    const argument = trimmed.match(/^ARG\s+BUN_VERSION=["']?([^\s"']+)/i)
    const runtime = image?.[1]?.replace(/-(?:debian|alpine|slim|distroless)$/, "") ?? argument?.[1]
    if (runtime && runtime !== bunVersion && !isDerived(runtime)) {
      offenders.push(`${file}:${index + 1}: Bun ${runtime} differs from packageManager bun@${bunVersion}`)
    }
    if (!trimmed.includes("NIKCLI_VERSION")) return

    const match = trimmed.match(ASSIGNMENT)
    if (!match) return

    const value = match[1]!
    // A continuation (`NIKCLI_VERSION="$(...)" \`) hands the value to the next
    // line's command; the expansion is still on this line, so isDerived holds.
    if (isDerived(value)) return

    offenders.push(`${file}:${index + 1}: NIKCLI_VERSION pinned to a literal (${value})`)
  })

  // E6 pins Effect in workspace manifests. Installing it positionally in an
  // image mutates that graph after validation, even if today's literal matches.
  // Check continued RUN commands too, and leave unrelated tooling (bunx) alone.
  const commands = lines
    .filter((line) => !line.trim().startsWith("#"))
    .join("\n")
    .replace(/\\\r?\n/g, " ")
  for (const install of commands.matchAll(/\bbun\s+(?:install|add)\b([^;&|\n]*)/g)) {
    for (const token of install[1]!.trim().split(/\s+/)) {
      const spec = token.replace(/^["']|["']$/g, "")
      if (!/^(?:effect|@effect\/[a-z0-9._-]+)(?:@[^\s]+)?$/.test(spec)) continue
      offenders.push(
        `${file}: ${spec} overrides workspace Effect dependencies; use bun install without package arguments`,
      )
    }
  }
}

if (offenders.length > 0) {
  console.error("✗ Docker images must preserve workspace dependency and nikcli versions:")
  for (const offender of offenders) console.error(`    ${offender}`)
  console.error("")
  console.error("  Read it off the manifest already in the build layer instead:")
  console.error(`    NIKCLI_VERSION="$(bun -e 'console.log(require("./package.json").version)')" \\`)
  console.error("        bun run script/build.ts ...")
  process.exit(1)
}

console.log(`✓ ${files.length} Docker/compose files preserve Bun ${bunVersion}, workspace Effect and nikcli versions`)
