#!/usr/bin/env bun

/**
 * upgrade-opentui.ts — move every `@opentui/*` pin at once, then prove the lockfile agrees.
 *
 * The pins are spread across a root catalog, an overrides block, a `patchedDependencies` key, and
 * `packages/tui`, and bumping them by hand has failed twice in ways that do not look like failures:
 *
 *   1. **Two resolved copies.** `opentui-spinner` declares an `@opentui/*` peer, so a bump that
 *      leaves its lockfile entries behind resolves a second copy of `@opentui/core`. Solid's
 *      renderer reuses nodes by `instanceof`, and two copies mean two class identities, so the TUI
 *      stops reusing anything and repaints wholesale. It runs. It just gets slower and flickers, and
 *      the version string says the upgrade worked.
 *   2. **A dead patch key.** `patchedDependencies` is keyed by exact `name@version`. Bump the
 *      version and bun silently applies nothing — see `script/check-patched-deps.ts`, which exists
 *      because that already happened once to a different package.
 *
 * So this script rewrites the patch key and renames the patch file with the pins, and then refuses
 * to exit 0 while `bun.lock` still mentions any other `@opentui/*` version.
 *
 * Ported from opencode v2 `script/upgrade-opentui.ts`; the `patchedDependencies` handling is ours,
 * because upstream carries no `@opentui` patch.
 *
 * Usage: bun run script/upgrade-opentui.ts [--snapshot] <version>
 */

import path from "node:path"

const args = process.argv.slice(2)
const usage = "Usage: bun run script/upgrade-opentui.ts [--snapshot] <version>"

if (args.includes("--help") || args.includes("-h")) {
  console.log(usage)
  process.exit(0)
}

const snapshotArg = args.find((arg) => arg.startsWith("--snapshot="))
const snapshot = args.includes("--snapshot") || snapshotArg !== undefined
const unknown = args.find((arg) => arg.startsWith("-") && arg !== "--snapshot" && !arg.startsWith("--snapshot="))
if (unknown) {
  console.error(`Unknown option: ${unknown}`)
  console.error(usage)
  process.exit(1)
}

const positional = args.filter((arg) => arg !== "--snapshot" && !arg.startsWith("--snapshot="))
const raw = snapshotArg?.slice("--snapshot=".length) || positional[0]
if (!raw || positional.length > (snapshotArg ? 0 : 1)) {
  console.error(usage)
  process.exit(1)
}

const ver = raw.replace(/^v/, "")
const root = path.resolve(import.meta.dir, "..")
const lockfile = path.join(root, "bun.lock")
const skip = new Set([".git", ".nikcli", ".turbo", "dist", "node_modules"])
const keys = ["@opentui/core", "@opentui/keymap", "@opentui/solid"] as const

const files = (await Array.fromAsync(new Bun.Glob("**/package.json").scan({ cwd: root }))).filter(
  (file) => !file.split("/").some((part) => skip.has(part)),
)

const setVersion = (cur: string, kind: "dep" | "peer") => {
  if (cur === "catalog:" || cur.startsWith("workspace:")) return cur
  if (snapshot) return ver
  if (kind === "peer") return `>=${ver}`
  if (cur.startsWith(">=")) return `>=${ver}`
  if (cur.startsWith("^")) return `^${ver}`
  if (cur.startsWith("~")) return `~${ver}`
  return ver
}

const editDeps = (obj: unknown, kind: "dep" | "peer") => {
  if (!obj || typeof obj !== "object") return false
  const map = obj as Record<string, unknown>
  return keys
    .map((key) => {
      const cur = map[key]
      if (typeof cur !== "string") return false
      const next = setVersion(cur, kind)
      if (next === cur) return false
      map[key] = next
      return true
    })
    .some(Boolean)
}

const editCatalog = (obj: unknown) => {
  if (!obj || typeof obj !== "object") return false
  const map = obj as Record<string, unknown>
  return keys
    .map((key) => {
      const cur = map[key]
      if (typeof cur !== "string" || cur === ver) return false
      map[key] = ver
      return true
    })
    .some(Boolean)
}

/**
 * Overrides point at the catalog *only where a catalog entry exists*.
 *
 * Upstream keeps `@opentui/*` in a root catalog, so its version of this script rewrites every
 * override to `catalog:` unconditionally. nikcli has no opentui catalog — its overrides carry literal
 * versions — and writing `catalog:` there resolves to nothing: `bun install` fails with
 * "@opentui/core@<ver> failed to resolve" and never writes a lockfile. Ask the manifest instead of
 * assuming the convention.
 */
const editOverrides = (obj: unknown, catalog: unknown) => {
  if (!obj || typeof obj !== "object") return false
  const map = obj as Record<string, unknown>
  const catalogued = catalog && typeof catalog === "object" ? (catalog as Record<string, unknown>) : {}
  return keys
    .map((key) => {
      const cur = map[key]
      if (typeof cur !== "string") return false
      const next = snapshot || typeof catalogued[key] !== "string" ? ver : "catalog:"
      if (next === cur) return false
      map[key] = next
      return true
    })
    .some(Boolean)
}

/**
 * Re-key `patchedDependencies` and rename the patch file to match.
 *
 * The rename is the point: a patch file named for the old version sitting next to a key for the new
 * one is exactly the state where everything *looks* patched and nothing is. Returns the renames so
 * the caller can report them, because a silently moved patch is the same problem one step later.
 */
const renamedPatches: Array<string> = []
const editPatchedDependencies = async (obj: unknown) => {
  if (!obj || typeof obj !== "object") return false
  const map = obj as Record<string, unknown>
  let changed = false
  for (const [entry, value] of Object.entries(map)) {
    const match = /^(@opentui\/[^@]+)@(.+)$/.exec(entry)
    if (!match || typeof value !== "string") continue
    const [, name, current] = match
    if (current === ver) continue
    const nextEntry = `${name}@${ver}`
    const nextValue = value.replace(encodeURIComponent(`@${current}`), encodeURIComponent(`@${ver}`)).replace(
      // The stored path encodes the scope slash but not the version separator, so cover both spellings.
      `@${current}.patch`,
      `@${ver}.patch`,
    )
    const from = path.join(root, value)
    const to = path.join(root, nextValue)
    if (await Bun.file(from).exists()) {
      await Bun.write(to, Bun.file(from))
      await Bun.file(from).delete()
      renamedPatches.push(`${value} -> ${nextValue}`)
    }
    delete map[entry]
    map[nextEntry] = nextValue
    changed = true
  }
  return changed
}

const out: Array<string> = []
for (const rel of files) {
  const file = path.join(root, rel)
  const json = JSON.parse(await Bun.file(file).text())
  const hit = [
    editCatalog(json.workspaces?.catalog),
    editOverrides(json.overrides, json.workspaces?.catalog),
    await editPatchedDependencies(json.patchedDependencies),
    editDeps(json.dependencies, "dep"),
    editDeps(json.devDependencies, "dep"),
    editDeps(json.peerDependencies, "peer"),
  ].some(Boolean)
  if (!hit) continue
  await Bun.write(file, `${JSON.stringify(json, null, 2)}\n`)
  out.push(rel)
}

if (out.length === 0) console.log(`No opentui manifest updates needed for ${ver}`)
else {
  console.log(`Updated opentui${snapshot ? " snapshot" : ""} to ${ver} in:`)
  for (const file of out) console.log(`- ${file}`)
}
for (const rename of renamedPatches) console.log(`Renamed patch: ${rename}`)

console.log("Running bun install to update bun.lock...")
const install = Bun.spawn([process.execPath, "install"], { cwd: root, stdout: "inherit", stderr: "inherit" })
const installCode = await install.exited
if (installCode !== 0) process.exit(installCode)

const fixed = await fixKnownLockfileIssues()
if (fixed.length > 0) {
  console.log("Removed stale opentui-spinner peer lockfile entries:")
  for (const item of fixed) console.log(`- ${item}`)
}

const stale = await findStaleLockfileEntries()
if (stale.length > 0) {
  console.error(`bun.lock still contains stale opentui versions after upgrading to ${ver}:`)
  for (const item of stale) console.error(`- ${item.entry}: ${item.pkg}@${item.version}`)
  console.error("Two resolved copies of @opentui/core break Solid's instanceof node reuse; see the header.")
  process.exit(1)
}

console.log("bun.lock opentui versions are consistent")

/**
 * `opentui-spinner` pins an `@opentui/*` peer of its own, and bun keeps the old resolution for it.
 * Dropping those entries lets the next install collapse onto the single version everything else uses.
 */
async function fixKnownLockfileIssues() {
  const txt = await Bun.file(lockfile).text()
  const stale = findStaleLockfileEntriesInText(txt)
  if (stale.length === 0) return []
  if (stale.some((item) => !item.entry.startsWith("opentui-spinner/@opentui/"))) return []

  const removed = txt
    .split("\n")
    .map((line) => /^ {4}"(opentui-spinner\/@opentui\/[^"]+)": /.exec(line)?.[1])
    .filter((item): item is string => item !== undefined)
  if (removed.length === 0) return []

  await Bun.write(
    lockfile,
    txt
      .split("\n")
      .filter((line) => !/^ {4}"opentui-spinner\/@opentui\//.test(line))
      .join("\n"),
  )
  return removed
}

async function findStaleLockfileEntries() {
  return findStaleLockfileEntriesInText(await Bun.file(lockfile).text())
}

function findStaleLockfileEntriesInText(txt: string) {
  return Array.from(txt.matchAll(/^ {4}"([^"]+)": \["(@opentui\/(?:core(?:-[^@"]+)?|keymap|solid))@([^"]+)"/gm))
    .map((match) => ({ entry: match[1]!, pkg: match[2]!, version: match[3]! }))
    .filter((item) => item.version !== ver)
}
