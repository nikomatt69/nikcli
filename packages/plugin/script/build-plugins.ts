import { readdirSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const pluginsDir = join(scriptDir, "..", "plugins")

const plugins = readdirSync(pluginsDir, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort()

console.log(`Building ${plugins.length} plugins...\n`)

let failed = 0

for (const plugin of plugins) {
  const tsconfig = join(pluginsDir, plugin, "tsconfig.json")
  process.stdout.write(`  ${plugin.padEnd(30)}`)

  const result = Bun.spawnSync(["tsc", "--project", tsconfig], {
    stdout: "pipe",
    stderr: "pipe",
    cwd: join(pluginsDir, ".."),
  })

  if (result.exitCode !== 0) {
    console.log("✗ FAILED")
    const stderr = result.stderr.toString().trim()
    if (stderr) console.error(stderr.split("\n").map((l) => `    ${l}`).join("\n"))
    failed++
  } else {
    console.log("✓")
  }
}

console.log("")
if (failed > 0) {
  console.error(`${failed} plugin(s) failed to build.`)
  process.exit(1)
}
console.log(`All ${plugins.length} plugins built successfully.`)
