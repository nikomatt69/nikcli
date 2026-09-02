#!/usr/bin/env bun
/**
 * A `patchedDependencies` entry is keyed by an exact `name@version`. Bump the
 * dependency and the key stops matching, so bun applies nothing — no warning,
 * no error, no trace in the install output. The patch file stays in the repo
 * and stays in `package.json`, which is exactly what makes it invisible: every
 * signal a reviewer would look at still says the patch is there.
 *
 * That is not hypothetical. `@modelcontextprotocol/sdk` went 1.25.2 -> 1.26.0
 * and silently dropped the fix that stops an SSE reconnect storm when a server
 * answers a JSON-RPC *error*; the regression test caught it 25 days later, and
 * only because it happened to be run. This check is the signal that was
 * missing.
 *
 * Three ways a patch stops protecting what it claims to:
 *
 * 1. **dead key** — the patched version is not installed at all. The patch is
 *    inert. This is the failure above.
 * 2. **missing file** — the key resolves but the `.patch` is gone.
 * 3. **uncovered workspace** — a workspace in this repo depends on the package
 *    but resolves to a *different* version than the one patched, so it runs
 *    without the fix while the patch entry suggests otherwise. `packages/app`
 *    was on `ghostty-web@0.4.0` while the codepoint-guard patch covered only
 *    the `0.3.0` that nikcli and remote use.
 *
 *    Scoped to workspaces on purpose. A second copy pulled in by some
 *    unrelated third-party dependency is not evidence of anything — flagging
 *    those makes the check noisy and trains people to skip it.
 *
 * Read from `bun.lock` rather than `node_modules`, so this answers the same
 * way before and after an install and cannot be fooled by a stale tree.
 */

import { existsSync } from "fs"
import path from "path"

// Defaults to the repo, but takes a root so the check can be exercised against
// fixtures. Asserting against the live tree would only ever pin today's state.
const root = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(import.meta.dir, "..")

/** `bun.lock` is JSONC with trailing commas; parse it without pulling a dep. */
function parseLockfile(text: string): any {
  return JSON.parse(text.replace(/,(\s*[}\]])/g, "$1"))
}

/** Split `@scope/name@1.2.3` into its name and version. */
function splitSpecifier(specifier: string) {
  const at = specifier.lastIndexOf("@")
  if (at <= 0) return { name: specifier, version: "" }
  return { name: specifier.slice(0, at), version: specifier.slice(at + 1) }
}

const lock = parseLockfile(await Bun.file(path.join(root, "bun.lock")).text())
const manifest = await Bun.file(path.join(root, "package.json")).json()

const declared: Record<string, string> = manifest.patchedDependencies ?? {}

// Every resolved version in the tree, grouped by package name. A lockfile
// entry's first element is the `name@version` it resolved to.
const installed = new Map<string, Set<string>>()
for (const entry of Object.values(lock.packages ?? {}) as unknown[]) {
  const specifier = Array.isArray(entry) ? entry[0] : undefined
  if (typeof specifier !== "string") continue
  const { name, version } = splitSpecifier(specifier)
  if (!version) continue
  let versions = installed.get(name)
  if (!versions) installed.set(name, (versions = new Set()))
  versions.add(version)
}

/**
 * The version a given workspace actually gets for a package. Bun keys a
 * workspace-specific resolution as `<workspace name>/<package>` and falls back
 * to the hoisted bare `<package>` entry when there is only one copy.
 */
function resolutionFor(workspaceName: string | undefined, name: string) {
  const entry =
    (workspaceName ? lock.packages?.[`${workspaceName}/${name}`] : undefined) ?? lock.packages?.[name] ?? undefined
  const specifier = Array.isArray(entry) ? entry[0] : undefined
  if (typeof specifier !== "string") return undefined
  return splitSpecifier(specifier).version || undefined
}

const problems: string[] = []

/** Package name -> every version a declared patch covers. */
const patchedVersions = new Map<string, Set<string>>()

for (const [key, patchFile] of Object.entries(declared)) {
  const { name, version } = splitSpecifier(key)
  const versions = installed.get(name) ?? new Set<string>()

  if (!existsSync(path.join(root, patchFile))) {
    problems.push(`${key}: patch file ${patchFile} does not exist`)
    continue
  }

  if (!versions.has(version)) {
    const found = versions.size ? [...versions].sort().join(", ") : "nothing"
    problems.push(
      `${key}: not installed, so the patch is never applied (installed: ${found}). ` +
        `Re-key the entry to the installed version and confirm the patch still applies.`,
    )
    continue
  }

  let covered = patchedVersions.get(name)
  if (!covered) patchedVersions.set(name, (covered = new Set()))
  covered.add(version)
}

// A package may legitimately carry one patch per version it is installed at,
// so a workspace is only unprotected if its resolution matches *none* of them.
// Checking per patch entry instead would make every entry accuse the others.
for (const [name, covered] of patchedVersions) {
  for (const [workspacePath, workspace] of Object.entries(lock.workspaces ?? {}) as [string, any][]) {
    const declares =
      workspace?.dependencies?.[name] ?? workspace?.devDependencies?.[name] ?? workspace?.peerDependencies?.[name]
    if (declares === undefined) continue
    const resolved = resolutionFor(workspace?.name, name)
    if (resolved === undefined || covered.has(resolved)) continue
    problems.push(
      `${name}: ${workspacePath || "<root>"} resolves to ${resolved}, but the patches cover ` +
        `${[...covered].sort().join(", ")}. That workspace runs unpatched — align the versions, ` +
        `or add a patch for ${resolved}.`,
    )
  }
}

// A patch file nobody references is dead weight that reads as coverage.
const referenced = new Set(Object.values(declared))
const glob = new Bun.Glob("patches/*.patch")
for await (const file of glob.scan({ cwd: root })) {
  if (!referenced.has(file)) {
    problems.push(`${file}: present in patches/ but not referenced by patchedDependencies`)
  }
}

if (problems.length > 0) {
  console.error("Patched dependency check failed:\n")
  for (const problem of problems) console.error(`  - ${problem}`)
  console.error("")
  process.exit(1)
}

console.log(`Patched dependency check passed (${Object.keys(declared).length} patches).`)
