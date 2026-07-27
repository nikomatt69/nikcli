/**
 * Build packages/web/public/brand/brandkit.zip from packages/mobile/assets.
 *
 * - Stages every PNG from packages/mobile/assets/ with its original filename.
 * - Adds a README.md describing the kit.
 * - Uses the system `zip` binary (sufficient, no JS dependency).
 * - Output is committed to packages/web/public/brand/brandkit.zip so the
 *   docs site serves it as a static asset (the docs brand page links to it).
 *
 * Run with:
 *   bun run --cwd packages/web script/build-brandkit.ts
 *
 * Re-run whenever a source asset in packages/mobile/assets/ changes.
 */
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { rm } from "node:fs/promises"
import { spawnSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const webRoot = path.resolve(here, "..")
const monoRoot = path.resolve(webRoot, "../..")

const SOURCE_DIR = path.join(monoRoot, "packages/mobile/assets")
const STAGING_DIR = path.join(webRoot, "public/brand/.brandkit-staging")
const OUTPUT_DIR = path.join(webRoot, "public/brand")
const OUTPUT_FILE = path.join(OUTPUT_DIR, "brandkit.zip")

const ALLOWED_EXTENSIONS = new Set([".png", ".PNG"])

const readme = `# nikcli brand kit

Generated ${new Date().toISOString().slice(0, 10)} from packages/mobile/assets/.

Every file inside this archive is a portable rasterization of the nikcli brand.
Filenames and content match the source files committed to \`packages/mobile/assets/\`.

## What's inside

- **wordmark-{dark,light}.png** — pixel wordmark, 632×206, transparent background
  - \`wordmark.png\` is the master (identical to \`wordmark-dark.png\`)
- **icon-{dark,light}.png** — 1024×1024 app icons (light + dark surfaces)
  - \`icon.png\` is the master (identical to \`icon-dark.png\`)
- **adaptive-icon-{,-light}.png** — 1024×1024 Android-adaptive layer (33% safe zone)
- **app-icon-mark-{,-light}.png** — 128×128 monograms for tab bars and docks
- **favicon-{,-light}.png** — 48×48 web favicons
- **splash-{dark,light}.png** — 1024×1024 launch screens
  - \`splash.png\` is the master (identical to \`splash-dark.png\`)

## How to use

Open the brand assets docs page for usage rules, theme pairing, and aspect ratios:

    /docs/brand

## Source of truth

These PNGs are mirrored from \`packages/mobile/assets/\`. Re-run the build
script whenever a source asset changes:

    bun run --cwd packages/web script/build-brandkit.ts
`

function listPng(directory: string): string[] {
  if (!existsSync(directory)) {
    throw new Error(`Source directory does not exist: ${directory}`)
  }
  const entries = readdirSync(directory).sort()
  const pngs: string[] = []
  for (const entry of entries) {
    if (!ALLOWED_EXTENSIONS.has(path.extname(entry))) continue
    const fullPath = path.join(directory, entry)
    if (!statSync(fullPath).isFile()) continue
    pngs.push(entry)
  }
  return pngs
}

function stageAssets(pngs: string[]): void {
  if (!existsSync(STAGING_DIR)) mkdirSync(STAGING_DIR, { recursive: true })
  for (const name of pngs) {
    const sourcePath = path.join(SOURCE_DIR, name)
    const stagedPath = path.join(STAGING_DIR, name)
    const contents = require("node:fs").readFileSync(sourcePath)
    writeFileSync(stagedPath, contents)
  }
  writeFileSync(path.join(STAGING_DIR, "README.md"), readme)
}

function writeStagingManifest(pngs: string[]): void {
  const lines = ["name,size_bytes", ...pngs.map((name) => {
    const size = statSync(path.join(STAGING_DIR, name)).size
    return `${name},${size}`
  }), `README.md,${statSync(path.join(STAGING_DIR, "README.md")).size}`]
  writeFileSync(path.join(STAGING_DIR, "MANIFEST.csv"), lines.join("\n") + "\n")
}

function runZip(): void {
  const result = spawnSync(
    "zip",
    ["-r", "-X", "-q", "-9", path.relative(STAGING_DIR, OUTPUT_FILE), "."],
    { cwd: STAGING_DIR, stdio: "inherit" },
  )
  if (result.status !== 0) {
    throw new Error(`zip exited with code ${result.status}`)
  }
}

async function main(): Promise<void> {
  console.log(`[brandkit] source: ${SOURCE_DIR}`)
  console.log(`[brandkit] output: ${OUTPUT_FILE}`)
  const pngs = listPng(SOURCE_DIR)
  if (pngs.length === 0) {
    throw new Error(`No PNG files found in ${SOURCE_DIR}`)
  }
  console.log(`[brandkit] staging ${pngs.length} PNG files...`)
  stageAssets(pngs)
  writeStagingManifest(pngs)
  runZip()
  const sizeKb = Math.round(statSync(OUTPUT_FILE).size / 1024)
  console.log(`[brandkit] wrote ${OUTPUT_FILE} (${sizeKb} KB)`)
  await rm(STAGING_DIR, { recursive: true, force: true })
}

main().catch((error) => {
  console.error(`[brandkit] ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
