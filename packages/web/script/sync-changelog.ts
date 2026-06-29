/**
 * Copies the monorepo root CHANGELOG.md into the web package so it can be
 * bundled at build time and rendered by /changelog.
 *
 * Runs as part of `build` (and `dev`), so every new version pushed — which
 * redeploys the site — refreshes the bundled changelog automatically.
 */
import { copyFileSync, existsSync, mkdirSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const monoRoot = path.resolve(webRoot, "../..")

const source = path.join(monoRoot, "CHANGELOG.md")
const destDir = path.join(webRoot, "src/data")
const dest = path.join(destDir, "changelog.md")

if (!existsSync(source)) {
  // Isolated builds may not include the root CHANGELOG.md; keep any existing
  // bundled copy rather than failing the build.
  if (existsSync(dest)) {
    console.warn(`[sync-changelog] root CHANGELOG.md missing, keeping bundled copy at ${dest}`)
    process.exit(0)
  }
  console.error(`[sync-changelog] CHANGELOG.md not found at ${source}`)
  process.exit(1)
}

mkdirSync(destDir, { recursive: true })
copyFileSync(source, dest)
console.log(`[sync-changelog] copied ${source} -> ${dest}`)
