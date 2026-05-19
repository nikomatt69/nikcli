#!/usr/bin/env bun

import { $ } from "bun"
import { Script } from "@nikcli-ai/script"
import { buildNotes, getLatestRelease } from "./changelog"

let notes: string[] = []

console.log("=== publishing ===\n")

if (!Script.preview) {
  const previous = await getLatestRelease()
  try {
    notes = await buildNotes(previous, "HEAD")
  } catch (e) {
    console.log("Could not build changelog notes (nikcli not installed):", e)
    notes = []
  }
}

const pkgjsons = await Array.fromAsync(
  new Bun.Glob("**/package.json").scan({
    absolute: true,
  }),
).then((arr) => arr.filter((x) => !x.includes("node_modules") && !x.includes("dist")))

for (const file of pkgjsons) {
  let pkg = await Bun.file(file).text()
  pkg = pkg.replaceAll(/"version": "[^"]+"/g, `"version": "${Script.version}"`)
  console.log("updated:", file)
  await Bun.file(file).write(pkg)
}

const extensionToml = new URL("../packages/extensions/zed/extension.toml", import.meta.url).pathname
if (await Bun.file(extensionToml).exists()) {
  let toml = await Bun.file(extensionToml).text()
  toml = toml.replace(/^version = "[^"]+"/m, `version = "${Script.version}"`)
  toml = toml.replaceAll(/releases\/download\/v[^/]+\//g, `releases/download/v${Script.version}/`)
  console.log("updated:", extensionToml)
  await Bun.file(extensionToml).write(toml)
}

await $`bun install`

console.log("\n=== nikcli ===\n")
await import(`../packages/nikcli/script/publish.ts`)

console.log("\n=== sdk ===\n")
await import(`../packages/sdk/js/script/publish.ts`)

console.log("\n=== plugin ===\n")
await import(`../packages/plugin/script/publish.ts`)

const dir = new URL("..", import.meta.url).pathname
process.chdir(dir)

let output = `version=${Script.version}\n`

if (!Script.preview) {
  const branch = process.env.GITHUB_REF_NAME || (await $`git branch --show-current`.text().then((x) => x.trim()))
  if (!branch) {
    throw new Error("Unable to determine branch for release push")
  }
  // Use GH_PUSH_TOKEN (workflow token) for pushing — SST_GITHUB_TOKEN is a GitHub App
  // token and lacks 'workflows' permission needed to push .yml files.
  // GITHUB_TOKEN env var from the workflow resolves to the GitHub App token value,
  // so we must use a separate env var name (GH_PUSH_TOKEN) to avoid the conflict.
  const pushToken =
    process.env.GH_PUSH_TOKEN ||
    process.env.GITHUB_TOKEN ||
    process.env.SST_GITHUB_TOKEN
  await $`git remote set-url origin https://x-access-token:${pushToken}@github.com/nikomatt69/nikcli`
  await $`git fetch origin ${branch}`
  // Drop any unintended modifications to workflow/action YAML — GitHub blocks
  // GITHUB_TOKEN from pushing changes under .github/workflows/* by design.
  // If prettier/format steps touched them, restore from index to keep the release push clean.
  // Also restore install scripts to avoid triggering CI loops on those changes.
  await $`git checkout -- .github/workflows .github/actions install packages/web/install`.nothrow()
  await $`git commit -am "release: v${Script.version}"`
  await $`git add -A`
  await $`git commit --amend --no-edit`
  await $`git tag v${Script.version}`
  await $`git push origin HEAD:${branch} v${Script.version}`
  await new Promise((resolve) => setTimeout(resolve, 5_000))
  await $`gh release create v${Script.version} -d --title "v${Script.version}" --notes ${notes.join("\n") || "No notable changes"} ./packages/nikcli/dist/*.zip ./packages/nikcli/dist/*.tar.gz`
  const release = await $`gh release view v${Script.version} --json id,tagName`.json()
  output += `release=${release.id}\n`
  output += `tag=${release.tagName}\n`
}

if (process.env.GITHUB_OUTPUT) {
  await Bun.write(process.env.GITHUB_OUTPUT, output)
}
