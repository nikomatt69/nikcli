import { $ } from "bun"

export const SIDECAR_BINARIES: Array<{ rustTarget: string; ocBinary: string; assetExt: string }> = [
  {
    rustTarget: "aarch64-apple-darwin",
    ocBinary: "nikcli-darwin-arm64",
    assetExt: "zip",
  },
  {
    rustTarget: "x86_64-apple-darwin",
    ocBinary: "nikcli-darwin-x64",
    assetExt: "zip",
  },
  {
    rustTarget: "x86_64-pc-windows-msvc",
    ocBinary: "nikcli-windows-x64",
    assetExt: "zip",
  },
  {
    rustTarget: "x86_64-unknown-linux-gnu",
    ocBinary: "nikcli-linux-x64",
    assetExt: "tar.gz",
  },
  {
    rustTarget: "aarch64-unknown-linux-gnu",
    ocBinary: "nikcli-linux-arm64",
    assetExt: "tar.gz",
  },
]

export const RUST_TARGET = Bun.env.RUST_TARGET

const RUST_TARGET_ALIASES: Record<string, string> = {
  // iOS simulator/device builds still execute the macOS sidecar in local dev,
  // so resolve them to the host-compatible binary artifact.
  "aarch64-apple-ios": "aarch64-apple-darwin",
  "aarch64-apple-ios-sim": "aarch64-apple-darwin",
  "x86_64-apple-ios": "x86_64-apple-darwin",
}

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
  const resolvedTarget = RUST_TARGET_ALIASES[rustTarget] ?? rustTarget
  const binaryConfig = SIDECAR_BINARIES.find((b) => b.rustTarget === resolvedTarget)
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
