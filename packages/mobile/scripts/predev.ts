import { $ } from "bun"

import { copyBinaryToSidecarFolder, getCurrentSidecar, windowsify } from "./utils"

if (Bun.env.NIKCLI_MOBILE_SIDECAR !== "1") {
  console.log(
    "Skipping sidecar build for mobile endpoint mode. Set NIKCLI_MOBILE_SIDECAR=1 to build and embed the sidecar.",
  )
  process.exit(0)
}

const RUST_TARGET = Bun.env.TAURI_ENV_TARGET_TRIPLE

const sidecarConfig = getCurrentSidecar(RUST_TARGET)

const binaryPath = windowsify(`../nikcli/dist/${sidecarConfig.ocBinary}/bin/nikcli`)

await $`cd ../nikcli && bun run build --single`

await copyBinaryToSidecarFolder(binaryPath, RUST_TARGET)
