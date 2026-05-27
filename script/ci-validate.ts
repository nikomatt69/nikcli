#!/usr/bin/env bun

/**
 * ci-validate.ts — Central validation runner for CI pipeline and autofix.
 *
 * Runs the same set of checks in both contexts so results are reproducible.
 * Writes a sanitized summary to tmp/ci-validation-summary.md and exits non-zero
 * on the first critical failure.
 */

import { $ } from "bun"
import { mkdirSync, writeFileSync, existsSync } from "fs"
import { dirname, join } from "path"

const SUMMARY_DIR = "tmp"
const SUMMARY_PATH = join(SUMMARY_DIR, "ci-validation-summary.md")

// Token-like patterns to redact from any captured output
const REDACT_PATTERNS = [
  /ghp_[A-Za-z0-9]{36,}/g,
  /gho_[A-Za-z0-9]{36,}/g,
  /github_pat_[A-Za-z0-9_]{22,}/g,
  /sk-[A-Za-z0-9_-]{20,}/g,
  /npm_[A-Za-z0-9]{36,}/g,
  /[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{20,}/g, // JWT-like
  /x-access-token:[A-Za-z0-9_-]+@/g, // URL-embedded tokens
]

function redact(output: string): string {
  for (const pattern of REDACT_PATTERNS) {
    output = output.replace(pattern, "[REDACTED]")
  }
  return output
}

interface ValidationStep {
  name: string
  command: string[]
  cwd?: string
  critical?: boolean // defaults to true
  timeout?: number // ms
}

const steps: ValidationStep[] = [
  {
    name: "Install dependencies",
    command: ["bun", "install", "--frozen-lockfile"],
    timeout: 120_000,
  },
  {
    name: "Typecheck",
    command: ["bun", "run", "typecheck"],
    timeout: 180_000,
  },
  {
    name: "Run tests",
    command: ["bun", "test"],
    timeout: 300_000,
    critical: false,
  },
  {
    name: "Run release automation tests",
    command: ["bun", "test", "test/release/automation.test.ts"],
    cwd: "packages/nikcli",
    timeout: 60_000,
    critical: false,
  },
  {
    name: "Shell syntax check (install script)",
    command: ["bash", "-n", "install"],
    critical: true,
    timeout: 10_000,
  },
]

interface StepResult {
  name: string
  passed: boolean
  durationMs: number
  outputTail: string
}

async function runStep(step: ValidationStep): Promise<StepResult> {
  const start = Date.now()
  let passed = false
  let outputTail = ""

  try {
    const proc = Bun.spawn(step.command, {
      cwd: step.cwd || process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, TERM: "dumb", CI: "true" },
    })

    const stdout = await new Response(proc.stdout).text()
    const stderr = await new Response(proc.stderr).text()
    const exitCode = await proc.exited

    const combined = `${stdout}\n${stderr}`.trim()
    const tailLines = combined.split("\n").slice(-20).join("\n")
    outputTail = redact(tailLines)
    passed = exitCode === 0
  } catch (err) {
    outputTail = redact(String(err))
    passed = false
  }

  return {
    name: step.name,
    passed,
    durationMs: Date.now() - start,
    outputTail,
  }
}

async function main() {
  // Ensure summary directory exists
  if (!existsSync(SUMMARY_DIR)) {
    mkdirSync(SUMMARY_DIR, { recursive: true })
  }

  const results: StepResult[] = []
  let hasCriticalFailure = false

  console.log("=== CI Validation Started ===\n")

  for (const step of steps) {
    const isCritical = step.critical !== false
    console.log(`▸ ${step.command.join(" ")}`)
    const result = await runStep(step)
    results.push(result)

    const icon = result.passed ? "✓" : "✗"
    const duration = (result.durationMs / 1000).toFixed(1)
    console.log(`  ${icon} ${step.name} (${duration}s)`)

    if (!result.passed && isCritical) {
      hasCriticalFailure = true
      // Continue running remaining steps for summary, but mark that we'll fail
    }
  }

  // Write summary
  const lines: string[] = []
  lines.push("# CI Validation Summary")
  lines.push("")
  lines.push(`**Triggered by:** ${process.env.GITHUB_EVENT_NAME || "local"}`)
  lines.push(`**Ref:** ${process.env.GITHUB_REF_NAME || "N/A"}`)
  lines.push(`**SHA:** ${process.env.GITHUB_SHA || "N/A"}`)
  lines.push("")

  const passedCount = results.filter((r) => r.passed).length
  const failedCount = results.filter((r) => !r.passed).length
  lines.push(`**Results:** ${passedCount} passed, ${failedCount} failed`)
  lines.push("")

  for (const result of results) {
    const icon = result.passed ? "✓" : "✗"
    lines.push(`## ${icon} ${result.name}`)
    if (!result.passed && result.outputTail) {
      lines.push("```")
      lines.push(result.outputTail)
      lines.push("```")
    }
    lines.push("")
  }

  writeFileSync(SUMMARY_PATH, lines.join("\n"))
  console.log(`\nSummary written to ${SUMMARY_PATH}`)

  if (hasCriticalFailure) {
    console.log("\n❌ Validation failed")
    process.exit(1)
  }

  console.log("\n✅ Validation passed")
}

main().catch((err) => {
  console.error("Validation runner crashed:", redact(String(err)))
  process.exit(2)
})
