#!/usr/bin/env bun
import { $ } from "bun"

import { copyBinaryToSidecarFolder, getCurrentSidecar, windowsify } from "./utils"

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
  // The `nikcli-cli` artifact is uploaded with `path: packages/nikcli/dist`, and
  // `upload-artifact` strips that common prefix — so the artifact root is the
  // *contents* of `dist`. Once downloaded the binary lives at
  // `${dir}/<ocBinary>/bin/<name>` (no `packages/nikcli/dist/` prefix).
  await $`gh run download ${runID} -n nikcli-cli -D ${dir}`
  await copyBinaryToSidecarFolder(windowsify(`${dir}/${sidecarConfig.ocBinary}/bin/${binaryName}`), RUST_TARGET)
  process.exit(0)
}

// Local path: build the CLI from source and copy it into the Tauri sidecars
// directory. Used by `bun run native:dev` on a developer machine.
const binaryPath = windowsify(`../nikcli/dist/${sidecarConfig.ocBinary}/bin/${binaryName}`)
await $`cd ../nikcli && bun run build --single --skip-install`
await copyBinaryToSidecarFolder(binaryPath, RUST_TARGET)
