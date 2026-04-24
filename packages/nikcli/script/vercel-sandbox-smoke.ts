#!/usr/bin/env bun

/**
 * Vercel Sandbox smoke test
 *
 * Creates a remote microVM sandbox, runs code inside it, captures output,
 * and verifies everything works end-to-end.
 *
 * Run with: bun run script/vercel-sandbox-smoke.ts
 *           bunx vercel dev -- npm run sandbox:vercel
 */

import { Sandbox } from "@vercel/sandbox"

const log = {
  info: (msg: string, extra?: Record<string, unknown>) => console.log(`[vercel-sandbox] ${msg}`, extra ?? ""),
  error: (msg: string, extra?: Record<string, unknown>) => console.error(`[vercel-sandbox] ERROR ${msg}`, extra ?? ""),
  ok: (msg: string, extra?: Record<string, unknown>) => console.log(`[vercel-sandbox] ✓ ${msg}`, extra ?? ""),
}

// Load env vars from .env.local so SDK can find VERCEL_OIDC_TOKEN
const envPath = new URL("../.env.local", import.meta.url)
const envContent = await Bun.file(envPath).text()
for (const line of envContent.split("\n")) {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith("#")) continue
  const eq = trimmed.indexOf("=")
  if (eq < 0) continue
  const key = trimmed.slice(0, eq)
  const val = trimmed.slice(eq + 1).replace(/^["']|["']$/g, "")
  if (key && key !== "PATH") process.env[key] = val
}

log.info("Starting smoke test...")

let sandbox: Sandbox | null = null
const start = Date.now()

try {
  // 1. Create a sandbox (2 minute timeout to limit cost)
  log.info("Creating sandbox (runtime=node24, timeout=2min)...")
  sandbox = await Sandbox.create({ runtime: "node24", timeout: 2 * 60 * 1000 })
  log.ok(`Sandbox created`, { id: sandbox.sandboxId, runtime: "node24" })

  // 2. Write a verify.js file into the sandbox
  const verifyScript = `
// verify.js — Vercel Sandbox smoke test script
const os = require('os');
console.log('Hello from Vercel Sandbox!');
console.log('Node version:', process.version);
console.log('Platform:', process.platform);
console.log('Arch:', process.arch);
console.log('Hostname:', os.hostname());
`

  await sandbox.fs.writeFile("/vercel/sandbox/verify.js", verifyScript)
  log.ok("verify.js written to sandbox")

  // 3. Run the script
  log.info("Running verify.js inside sandbox...")
  const cmd = await sandbox.runCommand({
    cmd: "node",
    args: ["verify.js"],
    cwd: "/vercel/sandbox",
  })

  log.info("Waiting for command to finish...")
  const result = await cmd.wait()

  // 4. Capture and display output
  const stdout = await result.stdout()
  const stderr = await result.stderr()

  console.log("\n--- STDOUT ---")
  console.log(stdout || "(empty)")

  if (stderr) {
    console.error("\n--- STDERR ---")
    console.error(stderr)
  }

  console.log(`\n--- EXIT CODE: ${result.exitCode} ---`)

  // 5. Verify expected output
  if (result.exitCode !== 0) {
    log.error("Command exited non-zero", { exitCode: result.exitCode })
    process.exitCode = 1
  } else if (!stdout.includes("Hello from Vercel Sandbox!")) {
    log.error("Output missing expected message")
    process.exitCode = 1
  } else {
    log.ok("Smoke test PASSED", {
      sandboxId: sandbox.sandboxId,
      cmdId: cmd.cmdId,
      exitCode: result.exitCode,
      duration: `${Date.now() - start}ms`,
    })
  }
} catch (err) {
  log.error("Unexpected error", { error: String(err) })
  process.exitCode = 1
} finally {
  // Always stop the sandbox to avoid unnecessary cost
  if (sandbox) {
    try {
      log.info("Stopping sandbox...")
      await sandbox.stop({ blocking: true })
      log.ok("Sandbox stopped")
    } catch (stopErr) {
      log.error("Failed to stop sandbox", { error: String(stopErr) })
    }
  }
  log.info(`Total duration: ${Date.now() - start}ms`)
}
