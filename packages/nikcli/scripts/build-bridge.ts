#!/usr/bin/env node
// Build script for the computer-use native helper

import { spawn } from "node:child_process"
import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, "..")
const sourcePath = path.join(rootDir, "src/plugin/computer-use/native/macos/bridge.swift")
const prebuiltDir = path.join(rootDir, "prebuilt/macos")

function getArg(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  if (index >= 0 && index + 1 < process.argv.length) {
    return process.argv[index + 1]
  }
  return undefined
}

function normalizeArch(arch: string): string {
  if (arch === "arm64" || arch === "x64") return arch
  if (arch === "x64") return "x64"
  return "arm64"
}

async function run(command: string, args: string[]): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" })
    child.on("error", reject)
    child.on("close", (code) => {
      if (code === 0) {
        resolve()
        return
      }
      reject(new Error(`Command failed (${code}): ${command} ${args.join(" ")}`))
    })
  })
}

async function main(): Promise<void> {
  if (process.platform !== "darwin") {
    console.error("build-bridge is only supported on macOS.")
    process.exit(1)
    return
  }

  const arch = normalizeArch(getArg("--arch") ?? process.arch)
  const outputArg = getArg("--output")
  const outputPath = outputArg ? path.resolve(process.cwd(), outputArg) : path.join(prebuiltDir, arch, "bridge")

  await fs.mkdir(path.dirname(outputPath), { recursive: true })

  const swiftArgs = [
    "swiftc",
    "-O",
    "-framework",
    "ApplicationServices",
    "-framework",
    "AppKit",
    "-framework",
    "ScreenCaptureKit",
    "-framework",
    "Foundation",
    sourcePath,
    "-o",
    outputPath,
  ]

  console.log(`Building computer-use native helper for ${arch}...`)
  await run("xcrun", swiftArgs)
  await fs.chmod(outputPath, 0o755)
  console.log(`Built helper at ${outputPath}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
