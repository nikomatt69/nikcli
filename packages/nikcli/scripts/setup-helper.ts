#!/usr/bin/env node
// Setup script for installing the computer-use native helper

import { spawn } from "node:child_process"
import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import os from "node:os"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, "..")
const prebuiltDir = path.join(rootDir, "prebuilt/macos")
const helperDir = path.join(os.homedir(), ".nikcli", "helpers", "computer-use")
const helperPath = path.join(helperDir, "bridge")

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
    console.log("Computer-use is only available on macOS.")
    return
  }

  const arch = process.arch === "arm64" ? "arm64" : "x64"
  const prebuiltPath = path.join(prebuiltDir, arch, "bridge")

  // Check if prebuilt binary exists
  try {
    await fs.access(prebuiltPath)
    console.log(`Found prebuilt binary at ${prebuiltPath}`)
  } catch {
    console.log(`No prebuilt binary found for ${arch}, building...`)
    const buildScript = path.join(rootDir, "scripts", "build-bridge.ts")
    await run(process.execPath, [buildScript, "--arch", arch])
  }

  // Install to ~/.nikcli/helpers/computer-use/bridge
  console.log(`Installing helper to ${helperPath}`)
  await fs.mkdir(helperDir, { recursive: true })
  await fs.copyFile(prebuiltPath, helperPath)
  await fs.chmod(helperPath, 0o755)
  console.log("Helper installed successfully!")
  console.log(`Helper path: ${helperPath}`)
  console.log("\nRemember to grant Accessibility and Screen Recording permissions to the helper in System Settings.")
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
