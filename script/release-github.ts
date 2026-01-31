#!/usr/bin/env bun

import { $ } from "bun"
import { Script } from "@nikcli-ai/script"
import { buildNotes, getLatestRelease } from "./changelog"
import path from "path"

const bump = process.argv[2] || "patch"

console.log("=== creating github release ===\n")

const previous = await getLatestRelease()
const notes = await buildNotes(previous, "HEAD")

console.log("building nikcli...")
await $`cd packages/nikcli && bun run build`

console.log("\ncreating tar.gz archives...")
const distPath = path.resolve("packages/nikcli/dist")
const dirs = await Array.fromAsync(new Bun.Glob("*/").scan({ absolute: false, cwd: distPath }))

for (const dir of dirs) {
  const name = dir.replace(/\/$/, "")
  const tarPath = path.join(distPath, `${name}.tar.gz`)
  await $`tar -czf ${tarPath} -C ${path.join(distPath, name)} .`
  console.log(`created: ${name}.tar.gz`)
}

console.log("\ncreating release...")
const tag = `v${Script.version}`

await $`git add packages/nikcli/dist/*.tar.gz`
await $`git commit -m "release: ${tag}" --allow-empty`
await $`git tag ${tag}`
await $`git push origin ${tag}`

const files = await Array.fromAsync(new Bun.Glob("*.tar.gz").scan({ absolute: true, cwd: distPath }))
await $`gh release create ${tag} --title "${tag}" --notes ${notes.join("\n") || "Release ${tag}"} ${files}`

console.log(`\n✓ release ${tag} created successfully`)
