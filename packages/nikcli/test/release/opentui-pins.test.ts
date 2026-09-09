import { describe, expect, it } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"

/**
 * The OpenTUI pins, and the one thing about them that cannot be seen by reading a version string.
 *
 * Two resolved copies of `@opentui/core` do not fail anything. Solid's renderer reuses nodes by
 * `instanceof`, so two copies mean two class identities and the TUI silently stops reusing anything —
 * it runs, it just repaints wholesale and flickers, while every manifest says the upgrade worked.
 * `opentui-spinner` declares its own `@opentui/*` peers, which is how a second copy gets in.
 *
 * So the assertion is on the lockfile, not the manifests: exactly one resolved version, and every
 * declared pin agreeing with it.
 */
const root = path.resolve(import.meta.dir, "../../../..")
const read = (relative: string) => fs.readFile(path.join(root, relative), "utf8")

const PACKAGES = ["@opentui/core", "@opentui/solid", "@opentui/keymap"] as const

/** Versions bun actually resolved, per package, read from `bun.lock`. */
async function resolved() {
  const lock = await read("bun.lock")
  const found = new Map<string, Set<string>>()
  for (const match of lock.matchAll(/"(@opentui\/(?:core|solid|keymap))@([0-9][^"]*)"/g)) {
    const [, name, version] = match
    if (!found.has(name!)) found.set(name!, new Set())
    found.get(name!)!.add(version!)
  }
  return found
}

/** Every `@opentui/*` version literal declared across the workspace manifests. */
async function declared() {
  const manifests = [
    "package.json",
    ...(await fs.readdir(path.join(root, "packages"))).map((d) => `packages/${d}/package.json`),
  ]
  const out: Array<{ file: string; name: string; range: string }> = []
  for (const file of manifests) {
    let text: string
    try {
      text = await read(file)
    } catch {
      continue
    }
    const json = JSON.parse(text) as Record<string, Record<string, string> | undefined>
    for (const field of ["dependencies", "devDependencies", "peerDependencies", "overrides"]) {
      const block = json[field]
      if (!block) continue
      for (const name of PACKAGES) {
        const range = block[name]
        // `catalog:` and `workspace:` carry no version of their own to disagree with.
        if (typeof range !== "string" || range === "catalog:" || range.startsWith("workspace:")) continue
        out.push({ file, name, range })
      }
    }
  }
  return out
}

describe("OpenTUI pins", () => {
  it("resolves exactly one version of each @opentui package", async () => {
    for (const [name, versions] of await resolved()) {
      expect(
        [...versions],
        `${name} resolves ${versions.size} versions; a second copy breaks Solid's instanceof node reuse`,
      ).toHaveLength(1)
    }
  })

  it("declares no pin that disagrees with what was resolved", async () => {
    const versions = await resolved()
    for (const pin of await declared()) {
      const only = [...(versions.get(pin.name) ?? [])][0]
      if (only === undefined) continue
      const exact = pin.range.replace(/^[\^~]|^>=/, "")
      expect(exact, `${pin.file} pins ${pin.name}@${pin.range}, but ${only} is what resolved`).toBe(only)
    }
  })

  // `patchedDependencies` is keyed by exact name@version: bump the version without re-keying and bun
  // applies nothing, with no warning. The generic guard is script/check-patched-deps.ts; this pins the
  // coupling for the one package whose patch is load-bearing for streaming render.
  it("keeps the core patch keyed to the resolved version, with the file present", async () => {
    const manifest = JSON.parse(await read("package.json")) as {
      patchedDependencies?: Record<string, string>
    }
    const entries = Object.entries(manifest.patchedDependencies ?? {}).filter(([key]) =>
      key.startsWith("@opentui/core@"),
    )
    expect(entries).toHaveLength(1)
    const [key, file] = entries[0]!
    const only = [...((await resolved()).get("@opentui/core") ?? [])][0]
    expect(key).toBe(`@opentui/core@${only}`)
    expect(await fs.exists(path.join(root, file))).toBe(true)
    // The patch is the streaming-highlight reuse; if that hunk is gone the file no longer earns its keep.
    expect(await read(file)).toContain("_lastHighlightContent")
  })

  it("has an upgrade path that does not depend on remembering all of this", async () => {
    const script = await read("script/upgrade-opentui.ts")
    expect(script).toContain("patchedDependencies")
    expect(script).toContain("opentui-spinner")
    // Overrides may only become `catalog:` where a catalog entry exists — this repo has none, and
    // writing `catalog:` regardless makes `bun install` fail to resolve anything at all.
    expect(script).toContain('typeof catalogued[key] !== "string"')
  })
})
