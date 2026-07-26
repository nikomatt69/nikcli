#!/usr/bin/env node

import fs from "fs"
import path from "path"
import os from "os"
import { execSync } from "child_process"
import { fileURLToPath } from "url"
import { createRequire } from "module"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

function detectPlatformAndArch() {
  let platform
  switch (os.platform()) {
    case "darwin":
      platform = "darwin"
      break
    case "linux":
      platform = "linux"
      break
    case "win32":
      platform = "windows"
      break
    default:
      platform = os.platform()
      break
  }

  let arch
  switch (os.arch()) {
    case "x64":
      arch = "x64"
      break
    case "arm64":
      arch = "arm64"
      break
    default:
      arch = os.arch()
      break
  }

  return { platform, arch }
}

function detectMusl() {
  if (os.platform() !== "linux") return false
  try {
    const ldd = execSync("ldd --version 2>&1", { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] })
    if (ldd.toLowerCase().includes("musl")) return true
  } catch {}
  return fs.existsSync("/etc/alpine-release")
}

function detectBaseline() {
  if (os.platform() === "linux") {
    try {
      const cpuinfo = fs.readFileSync("/proc/cpuinfo", "utf8")
      return !cpuinfo.includes("avx2")
    } catch {}
    return false
  }
  if (os.platform() === "darwin") {
    try {
      const avx2 = execSync("sysctl -n hw.optional.avx2_0 2>/dev/null || echo 0", { encoding: "utf8" }).trim()
      return avx2 !== "1"
    } catch {}
  }
  return false
}

function tryResolvePackage(packageName, binaryName) {
  try {
    const packageJsonPath = require.resolve(`${packageName}/package.json`)
    const packageDir = path.dirname(packageJsonPath)
    const binaryPath = path.join(packageDir, "bin", binaryName)
    if (!fs.existsSync(binaryPath)) return null
    return binaryPath
  } catch {
    return null
  }
}

function findBinary() {
  const { platform, arch } = detectPlatformAndArch()
  const binaryName = platform === "windows" ? "nikcli.exe" : "nikcli"
  const isMusl = platform === "linux" ? detectMusl() : false
  const isBaseline = arch === "x64" ? detectBaseline() : false

  // Try in order: most specific → least specific
  const candidates = []

  if (isBaseline && isMusl) candidates.push(`nikcli-ai-${platform}-${arch}-baseline-musl`)
  if (isBaseline && !isMusl) candidates.push(`nikcli-ai-${platform}-${arch}-baseline`)
  if (!isBaseline && isMusl) candidates.push(`nikcli-ai-${platform}-${arch}-musl`)
  candidates.push(`nikcli-ai-${platform}-${arch}`)
  // Final fallbacks (skip musl/baseline restriction)
  if (isMusl) candidates.push(`nikcli-ai-${platform}-${arch}`)
  if (isBaseline) candidates.push(`nikcli-ai-${platform}-${arch}`)

  for (const name of candidates) {
    const found = tryResolvePackage(name, binaryName)
    if (found) {
      console.log(`nikcli: resolved binary from ${name}`)
      return { binaryPath: found, binaryName }
    }
  }

  throw new Error(
    `Could not find nikcli binary for ${platform}-${arch}${isMusl ? " (musl)" : ""}${isBaseline ? " (baseline)" : ""}.\n` +
      `Tried: ${candidates.join(", ")}\n` +
      `Install manually: https://nikcli.store/install`,
  )
}

function prepareBinDirectory(binaryName) {
  const binDir = path.join(__dirname, "..", "bin")
  const targetPath = path.join(binDir, binaryName)
  if (!fs.existsSync(binDir)) fs.mkdirSync(binDir, { recursive: true })
  if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath)
  return { binDir, targetPath }
}

function symlinkBinary(sourcePath, binaryName) {
  const { targetPath } = prepareBinDirectory(binaryName)
  fs.symlinkSync(sourcePath, targetPath)
  if (!fs.existsSync(targetPath)) throw new Error(`Failed to symlink binary to ${targetPath}`)
  console.log(`nikcli: ${targetPath} -> ${sourcePath}`)
}

async function main() {
  // Windows has no symlink to create — bin/nikcli resolves the platform package
  // at runtime — but the binary still has to be there, so fail here instead of
  // at the user's first `nikcli` invocation.
  if (os.platform() === "win32") {
    const { binaryPath } = findBinary()
    console.log(`nikcli: using ${binaryPath}`)
    return
  }

  const { binaryPath, binaryName } = findBinary()
  symlinkBinary(binaryPath, binaryName)
}

main().catch((error) => {
  console.error("nikcli postinstall failed:", error.message)
  process.exit(1)
})
