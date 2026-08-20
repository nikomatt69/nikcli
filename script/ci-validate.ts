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
    name: "Route coverage gate",
    command: ["bun", "run", "script/check-route-coverage.ts", "--strict"],
    cwd: "packages/nikcli",
    timeout: 30_000,
  },
  {
    // The package script, not a bare `bun test` from the root: run from here
    // Bun sweeps all 400+ test files in the monorepo — benchmarks, integration
    // suites and the simulation tests that boot a real TUI — with none of the
    // per-package bunfig (preload, timeout) applied. The full matrix is the
    // `test` workflow's job; validation only needs fast feedback on the core.
    // `--parallel=2`, not the default: --parallel implies --isolate, so each
    // worker carries its own module registry for a graph that pulls in OpenTUI,
    // the database and the server. One worker per core on a 4-vCPU runner drove
    // it out of memory, and the runner answered with a shutdown signal — which
    // kills the job outright, so `critical: false` below could not absorb it.
    // Three consecutive runs died ~2m into this step that way (exit 143).
    name: "Run tests",
    command: ["bun", "run", "test", "--", "--parallel=2"],
    cwd: "packages/nikcli",
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
  {
    // GitHub's ubuntu runners ship pwsh; local machines may not, and a missing
    // shell must not turn into a red pipeline.
    //
    // The trailing `exit 0` is load-bearing: without it pwsh printed the parse
    // result and then sat there instead of exiting, so the step hit its
    // timeout despite the check itself having passed. Telemetry is opted out
    // for the same reason — its first-run background work delays teardown.
    name: "PowerShell syntax check (install.ps1)",
    command: [
      "bash",
      "-c",
      'command -v pwsh >/dev/null 2>&1 || { echo "pwsh not available — skipped"; exit 0; }; ' +
        "POWERSHELL_TELEMETRY_OPTOUT=1 DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1 " +
        "pwsh -NoProfile -NonInteractive -NoLogo -Command '$e = $null; " +
        "[System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path ./install.ps1), [ref]$null, [ref]$e) | Out-Null; " +
        'if ($e) { $e | Out-String | Write-Error; exit 1 }; Write-Output "install.ps1 parses clean"; exit 0\'',
    ],
    critical: true,
    timeout: 60_000,
  },
]

interface StepResult {
  name: string
  passed: boolean
  durationMs: number
  outputTail: string
}

const DEFAULT_TIMEOUT = 300_000

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

    // The declared timeout is enforced here. Without it a hung step (a test
    // waiting on a socket, a watcher that never exits) ran until the job's own
    // limit — hours, for a pipeline that should report in minutes.
    const limit = step.timeout ?? DEFAULT_TIMEOUT
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      proc.kill(9)
    }, limit)

    const stdout = await new Response(proc.stdout).text()
    const stderr = await new Response(proc.stderr).text()
    const exitCode = await proc.exited
    clearTimeout(timer)

    const combined = `${stdout}\n${stderr}`.trim()
    const tailLines = combined.split("\n").slice(-20).join("\n")
    outputTail = redact(timedOut ? `${tailLines}\n[timed out after ${(limit / 1000).toFixed(0)}s]` : tailLines)
    passed = !timedOut && exitCode === 0
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
