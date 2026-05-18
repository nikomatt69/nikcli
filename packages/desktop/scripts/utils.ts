import { $ } from "bun"

export const SIDECAR_BINARIES: Array<{ rustTarget: string; ocBinary: string; assetExt: string }> = [
  {
    rustTarget: "aarch64-apple-darwin",
    ocBinary: "nikcli-ai-darwin-arm64",
    assetExt: "zip",
  },
  {
    rustTarget: "x86_64-apple-darwin",
    ocBinary: "nikcli-ai-darwin-x64",
    assetExt: "zip",
  },
  {
    rustTarget: "x86_64-pc-windows-msvc",
    ocBinary: "nikcli-ai-windows-x64",
    assetExt: "zip",
  },
  {
    rustTarget: "x86_64-unknown-linux-gnu",
    ocBinary: "nikcli-ai-linux-x64",
    assetExt: "tar.gz",
  },
  {
    rustTarget: "aarch64-unknown-linux-gnu",
    ocBinary: "nikcli-ai-linux-arm64",
    assetExt: "tar.gz",
  },
]

export const RUST_TARGET = Bun.env.RUST_TARGET

function inferRustTargetFromHost() {
  // Bun/Node style platform+arch -> Rust target triple.
  const platform = process.platform
  const arch = process.arch

  if (platform === "darwin") {
    if (arch === "arm64") return "aarch64-apple-darwin"
    if (arch === "x64") return "x86_64-apple-darwin"
  }

  if (platform === "win32") {
    if (arch === "x64") return "x86_64-pc-windows-msvc"
  }

  if (platform === "linux") {
    if (arch === "x64") return "x86_64-unknown-linux-gnu"
    if (arch === "arm64") return "aarch64-unknown-linux-gnu"
  }

  throw new Error(`RUST_TARGET not set and could not infer target from host (${platform}/${arch})`)
}

function resolveRustTarget(target?: string) {
  return target ?? RUST_TARGET ?? inferRustTargetFromHost()
}

export function getCurrentSidecar(target?: string) {
  const rustTarget = resolveRustTarget(target)
  const binaryConfig = SIDECAR_BINARIES.find((b) => b.rustTarget === rustTarget)
  if (!binaryConfig) throw new Error(`Sidecar configuration not available for Rust target '${rustTarget}'`)
  return binaryConfig
}

export async function copyBinaryToSidecarFolder(source: string, target = RUST_TARGET) {
  const rustTarget = resolveRustTarget(target)
  await $`mkdir -p src-tauri/sidecars`
  const dest = windowsify(`src-tauri/sidecars/nikcli-cli-${rustTarget}`)
  await $`cp ${source} ${dest}`

  console.log(`Copied ${source} to ${dest}`)
}

export function windowsify(path: string) {
  if (path.endsWith(".exe")) return path
  return `${path}${process.platform === "win32" ? ".exe" : ""}`
}
