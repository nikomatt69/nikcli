#!/usr/bin/env bun
import { $ } from "bun"

import { Script } from "@nikcli-ai/script"
import { copyBinaryToSidecarFolder, getCurrentSidecar, windowsify } from "./utils"

// Sync the desktop package.json to the current CLI version so the sidecar
// lookup matches what users have installed globally.
const pkg = await Bun.file("./package.json").json()
pkg.version = Script.version
await Bun.write("./package.json", JSON.stringify(pkg, null, 2) + "\n")

const RUST_TARGET = Bun.env.TAURI_ENV_TARGET_TRIPLE
const sidecarConfig = getCurrentSidecar(RUST_TARGET)
const binaryName = windowsify("nikcli")

// CI path: download the already-built CLI artifact uploaded by the publish job
// (`.github/workflows/publish.yml` → `nikcli-cli`) instead of rebuilding the CLI
// on every desktop runner. Rebuilding the CLI cross-platform during sidecar prep
// is fragile — Bun's "remap bin" step fails on Windows with
// `could not create process` — and the CLI binary is identical to what publish
// just produced, so there's nothing to gain from rebuilding it per platform.
const runID = Bun.env.CLI_ARTIFACT_RUN_ID

if (runID) {
  const dir = "src-tauri/target/nikcli-binaries"
  await $`mkdir -p ${dir}`
  // The `nikcli-cli` artifact uploads `packages/nikcli/dist`, so once extracted
  // the binary lives at `${dir}/packages/nikcli/dist/<ocBinary>/bin/<name>`.
  await $`gh run download ${runID} -n nikcli-cli -D ${dir}`
  await copyBinaryToSidecarFolder(
    windowsify(`${dir}/packages/nikcli/dist/${sidecarConfig.ocBinary}/bin/${binaryName}`),
    RUST_TARGET,
  )
  process.exit(0)
}

// Local path: build the CLI from source and copy it into the Tauri sidecars
// directory. Used by `bun run native:dev` on a developer machine.
const binaryPath = windowsify(`../nikcli/dist/${sidecarConfig.ocBinary}/bin/${binaryName}`)
await $`cd ../nikcli && bun run build --single --skip-install`
await copyBinaryToSidecarFolder(binaryPath, RUST_TARGET)
