#!/usr/bin/env bun
import { $ } from "bun"

import { Script } from "@nikcli-ai/script"
import { copyBinaryToSidecarFolder, getCurrentSidecar, windowsify } from "./utils"

const pkg = await Bun.file("./package.json").json()
pkg.version = Script.version
await Bun.write("./package.json", JSON.stringify(pkg, null, 2) + "\n")
console.log(`Updated package.json version to ${Script.version}`)

const sidecarConfig = getCurrentSidecar()

const runID = Bun.env.GITHUB_RUN_ID

// CI path: download the already-built CLI artifact from the current GitHub Actions run.
if (runID) {
  const dir = "src-tauri/target/nikcli-binaries"
  await $`mkdir -p ${dir}`
  await $`gh run download ${runID} -n nikcli-cli`.cwd(dir)
  await copyBinaryToSidecarFolder(windowsify(`${dir}/${sidecarConfig.ocBinary}/bin/nikcli`))
  process.exit(0)
}

// Local path: build the CLI from source and copy it into the Tauri sidecars directory.
const binaryPath = windowsify(`../nikcli/dist/${sidecarConfig.ocBinary}/bin/nikcli`)
await $`cd ../nikcli && bun run build --single`
await copyBinaryToSidecarFolder(binaryPath)
