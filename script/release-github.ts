#!/usr/bin/env bun

import { $ } from "bun"
import { Script } from "@nikcli-ai/script"
import { buildNotes, getLatestRelease } from "./changelog"
import path from "path"
import fs from "fs"

console.log("=== creating github release ===\n")

const previous = await getLatestRelease()
const notes = await buildNotes(previous, "HEAD")

console.log("building nikcli...")
await $`cd packages/nikcli && bun run build`

console.log("\ncreating archives...")
const distPath = path.resolve("packages/nikcli/dist")
const dirs = fs
  .readdirSync(distPath, { withFileTypes: true })
  .filter((dirent) => dirent.isDirectory())
  .map((dirent) => dirent.name)

for (const name of dirs) {
  // Determine OS from folder name
  const isLinux = name.includes("linux")
  const isWindows = name.includes("windows")
  const isMacOS = name.includes("darwin")

  // Create tar.gz for Linux only — `<triplet>/bin/…` at archive root (matches install.sh + releases like 0.0.11)
  if (isLinux) {
    const tarPath = path.join(distPath, `${name}.tar.gz`)
    await $`tar -czf ${tarPath} -C ${distPath} ${name}`
    console.log(`created: ${name}.tar.gz`)
  }

  // Create zip for Windows and macOS
  if (isWindows || isMacOS) {
    const zipPath = path.join(distPath, `${name}.zip`)
    await $`zip -rq ${zipPath} ${name}`.cwd(distPath)
    console.log(`created: ${name}.zip`)
  }
}

console.log("\ncleaning up internal archives...")
for (const name of dirs) {
  const internalTgz = path.join(distPath, name, `${name}-${Script.version}.tgz`)
  if (await Bun.file(internalTgz).exists()) {
    await $`rm ${internalTgz}`
    console.log(`removed: ${name}/${name}-${Script.version}.tgz`)
  }
}

console.log("\ncreating release...")
const tag = `v${Script.version}`

await $`git add packages/nikcli/dist/*.tar.gz packages/nikcli/dist/*.zip`
await $`git commit -m "release: ${tag}" --allow-empty`
await $`git tag ${tag}`
await $`git push origin ${tag}`

const tarFiles = await Array.fromAsync(new Bun.Glob("*.tar.gz").scan({ absolute: true, cwd: distPath }))
const zipFiles = await Array.fromAsync(new Bun.Glob("*.zip").scan({ absolute: true, cwd: distPath }))
const files = [...tarFiles, ...zipFiles]
await $`gh release create ${tag} --title "${tag}" --notes ${notes.join("\n") || "Release ${tag}"} ${files}`

console.log(`\nrelease ${tag} created successfully`)
