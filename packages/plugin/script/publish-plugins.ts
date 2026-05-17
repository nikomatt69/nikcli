#!/usr/bin/env bun
import { readdirSync, writeFileSync, rmSync, existsSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"
import { $ } from "bun"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const pluginsDir = join(scriptDir, "..", "plugins")

// Determine publish tag from branch / env
const channel = await (async () => {
  if (process.env["NIKCLI_CHANNEL"]) return process.env["NIKCLI_CHANNEL"]
  const branch = await $`git branch --show-current`.text().then((x) => x.trim())
  return branch === "main" ? "latest" : branch
})()

const plugins = readdirSync(pluginsDir, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort()

console.log(`Publishing ${plugins.length} plugins → tag: ${channel}\n`)

let failed = 0

for (const plugin of plugins) {
  const pluginDir = join(pluginsDir, plugin)
  const pkgPath = join(pluginDir, "package.json")
  const distDir = join(pluginDir, "dist")

  if (!existsSync(distDir)) {
    console.log(`  ${plugin.padEnd(30)} ✗ SKIPPED (no dist — run build:plugins first)`)
    failed++
    continue
  }

  // Patch exports for publish
  const original = await Bun.file(pkgPath).text()
  const pkg = JSON.parse(original)
  pkg.exports = {
    ".": {
      import: "./dist/index.js",
      types: "./dist/index.d.ts",
    },
  }
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n")

  process.stdout.write(`  ${plugin.padEnd(30)}`)
  try {
    // Pack and publish from within the plugin dir
    const pack = Bun.spawnSync(["bun", "pm", "pack"], {
      cwd: pluginDir,
      stdout: "pipe",
      stderr: "pipe",
    })
    if (pack.exitCode !== 0) {
      throw new Error(pack.stderr.toString().trim() || "bun pm pack failed")
    }

    // Find the generated .tgz
    const tgz = readdirSync(pluginDir).find((f) => f.endsWith(".tgz"))
    if (!tgz) throw new Error("No .tgz found after pack")

    const publish = Bun.spawnSync(["npm", "publish", tgz, "--tag", channel, "--access", "public"], {
      cwd: pluginDir,
      stdout: "pipe",
      stderr: "pipe",
    })

    // Cleanup tarball
    rmSync(join(pluginDir, tgz))

    const publishStderr = publish.stderr.toString()
    if (publish.exitCode !== 0) {
      // E409 = version already exists — treat as success
      if (
        publishStderr.includes("E409") ||
        publishStderr.includes("You cannot publish over the previously published versions")
      ) {
        console.log(`✓  already published`)
      } else {
        throw new Error(publishStderr.trim() || "npm publish failed")
      }
    } else {
      console.log(`✓  published`)
    }
  } catch (err) {
    console.log(`✗ FAILED`)
    console.error(`    ${String(err).split("\n").join("\n    ")}`)
    failed++
  } finally {
    // Always restore original package.json
    writeFileSync(pkgPath, original)
  }
}

console.log("")
if (failed > 0) {
  console.error(`${failed} plugin(s) failed to publish.`)
  process.exit(1)
}
console.log(`All ${plugins.length} plugins published successfully (tag: ${channel}).`)
