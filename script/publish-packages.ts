#!/usr/bin/env bun
/**
 * Publishes all library packages to npm.
 * Skips: nikcli (requires platform binary builds), private packages.
 *
 * Usage:
 *   bun script/publish-packages.ts
 *   NIKCLI_CHANNEL=latest bun script/publish-packages.ts
 */

import { $ } from "bun"
import { writeFileSync, existsSync } from "fs"
import { join } from "path"

const root = new URL("..", import.meta.url).pathname
process.chdir(root)

const channel = await (async () => {
  if (process.env["NIKCLI_CHANNEL"]) return process.env["NIKCLI_CHANNEL"]
  const branch = await $`git branch --show-current`.text().then((x) => x.trim())
  return branch === "main" ? "latest" : branch
})()

console.log(`\n=== Publishing all packages → tag: ${channel} ===\n`)

type Result = { name: string; ok: boolean; error?: string }
const results: Result[] = []

async function run(label: string, fn: () => Promise<void>) {
  process.stdout.write(`  ${label.padEnd(36)}`)
  try {
    await fn()
    console.log("✓")
    results.push({ name: label, ok: true })
  } catch (err: any) {
    const msg = String(err?.message ?? err).split("\n")[0]
    console.log(`✗  ${msg}`)
    results.push({ name: label, ok: false, error: msg })
  }
}

// Helper: pack + publish from cwd, patching exports src→dist
async function publishWithDistExports(pkgDir: string, srcPrefix = "./src/", distPrefix = "./dist/") {
  const pkgPath = join(pkgDir, "package.json")
  const original = await Bun.file(pkgPath).text()
  const pkg = JSON.parse(original)

  for (const [key, value] of Object.entries(pkg.exports as Record<string, string>)) {
    if (typeof value !== "string") continue
    const file = value
      .replace(srcPrefix, distPrefix)
      .replace(/\.ts$/, "")
      .replace(/\.tsx$/, "")
    pkg.exports[key] = { import: file + ".js", types: file + ".d.ts" }
  }

  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2))
  try {
    const pack = Bun.spawnSync(["bun", "pm", "pack"], { cwd: pkgDir, stdout: "pipe", stderr: "pipe" })
    if (pack.exitCode !== 0) throw new Error(pack.stderr.toString().trim() || "pack failed")

    const tgz = (await $`ls ${pkgDir}/*.tgz`.text()).trim().split("\n").pop()!
    const publish = Bun.spawnSync(["npm", "publish", tgz, "--tag", channel, "--access", "public"], {
      cwd: pkgDir,
      stdout: "pipe",
      stderr: "pipe",
    })
    const stderr = publish.stderr.toString()
    Bun.spawnSync(["rm", "-f", tgz], { cwd: pkgDir })
    if (publish.exitCode !== 0) {
      if (stderr.includes("E409") || stderr.includes("You cannot publish over the previously published versions"))
        return
      throw new Error(stderr.split("\n").find((l) => l.includes("npm error")) ?? "publish failed")
    }
  } finally {
    writeFileSync(pkgPath, original)
  }
}

// Helper: publish source package as-is (no dist needed)
async function publishSource(pkgDir: string) {
  process.env["NPM_CONFIG_TAG"] = channel
  const pack = Bun.spawnSync(["bun", "pm", "pack"], { cwd: pkgDir, stdout: "pipe", stderr: "pipe" })
  if (pack.exitCode !== 0) throw new Error(pack.stderr.toString().trim() || "pack failed")
  const tgz = (await $`ls ${pkgDir}/*.tgz`.text()).trim().split("\n").pop()!
  const publish = Bun.spawnSync(["npm", "publish", tgz, "--tag", channel, "--access", "public"], {
    cwd: pkgDir,
    stdout: "pipe",
    stderr: "pipe",
  })
  Bun.spawnSync(["rm", "-f", tgz], { cwd: pkgDir })
  const stderr = publish.stderr.toString()
  if (publish.exitCode !== 0 && stderr.includes("npm error")) {
    throw new Error(stderr.split("\n").find((l) => l.includes("npm error")) ?? "publish failed")
  }
}

// ── @nikcli-ai/plugin ────────────────────────────────────────────────────────
await run("@nikcli-ai/plugin", async () => {
  const dir = join(root, "packages/plugin")
  process.chdir(dir)
  await import("../packages/plugin/script/publish.ts")
  process.chdir(root)
})

// ── @nikcli-ai/plugin-* (10 plugins) ─────────────────────────────────────────
await run("@nikcli-ai/plugin-* (10 plugins)", async () => {
  const dir = join(root, "packages/plugin")
  const res = Bun.spawnSync(["bun", "run", "publish:plugins"], {
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  })
  if (res.exitCode !== 0) throw new Error(res.stderr.toString().trim().split("\n").pop() ?? "failed")
})

// ── @nikcli-ai/sdk ───────────────────────────────────────────────────────────
await run("@nikcli-ai/sdk", async () => {
  const dir = join(root, "packages/sdk/js")
  const distDir = join(dir, "dist")
  if (!existsSync(distDir)) throw new Error("no dist — run packages/sdk/js/script/build.ts first")

  // publishConfig.directory = "dist" → bun pm pack publishes from dist/
  const pack = Bun.spawnSync(["bun", "pm", "pack"], { cwd: dir, stdout: "pipe", stderr: "pipe" })
  if (pack.exitCode !== 0) throw new Error(pack.stderr.toString().trim() || "pack failed")
  const tgz = (await $`ls ${dir}/*.tgz`.text()).trim().split("\n").pop()!
  const publish = Bun.spawnSync(["npm", "publish", tgz, "--tag", channel, "--access", "public"], {
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  })
  Bun.spawnSync(["rm", "-f", tgz], { cwd: dir })
  const stderr = publish.stderr.toString()
  if (publish.exitCode !== 0 && stderr.includes("npm error")) {
    throw new Error(stderr.split("\n").find((l) => l.includes("npm error")) ?? "publish failed")
  }
})

// ── @nikcli-ai/script ────────────────────────────────────────────────────────
await run("@nikcli-ai/script", async () => {
  await publishSource(join(root, "packages/script"))
})

// ── @nikcli-ai/app ───────────────────────────────────────────────────────────
await run("@nikcli-ai/app", async () => {
  await publishSource(join(root, "packages/app"))
})

// ── @nikcli-ai/ui ────────────────────────────────────────────────────────────
await run("@nikcli-ai/ui", async () => {
  await publishSource(join(root, "packages/ui"))
})

// ── summary ──────────────────────────────────────────────────────────────────
console.log("")
const failed = results.filter((r) => !r.ok)
if (failed.length > 0) {
  console.error(`${failed.length} package(s) failed:`)
  for (const r of failed) console.error(`  ✗ ${r.name}: ${r.error}`)
  process.exit(1)
}
console.log(`All ${results.length} packages published successfully (tag: ${channel}).`)
