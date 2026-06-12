import fs from "fs/promises"
import path from "path"
import {
  TARGET_PACKAGE_ROOT,
  SUITE_HISTORY_DIR,
  type RunnerState,
  type SuiteCaseResult,
  type SuiteRunResult,
  type SuiteExecStatus,
} from "../types"

export interface SuiteRunnerCallbacks {
  onLog: (chunk: string) => void
  onStateChange: (state: RunnerState, exitCode?: number) => void
  onStart: (runId: string) => void
  onResult: (result: SuiteRunResult) => void
  onDone: () => void
}

function sanitize(line: string): string {
  return line
    .replace(/\r/g, "")
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "")
    .replace(/\x1b\][0-9;]*[^\x1b]*(\x1b\\|\x07)/g, "")
}

async function pipe(stream: ReadableStream<Uint8Array> | null, onChunk: (s: string) => void): Promise<string> {
  if (!stream) return ""
  const reader = stream.getReader()
  const dec = new TextDecoder()
  let buf = ""
  let leftover = ""
  while (true) {
    const r = await reader.read()
    if (r.done) break
    const chunk = sanitize(dec.decode(r.value, { stream: true }))
    buf += chunk
    leftover += chunk
    const idx = leftover.lastIndexOf("\n")
    if (idx >= 0) {
      onChunk(leftover.slice(0, idx + 1))
      leftover = leftover.slice(idx + 1)
    }
  }
  if (leftover) onChunk(leftover)
  return buf
}

interface ParsedOutput {
  totalTests: number
  passed: number
  failed: number
  skipped: number
  todo: number
  cases: SuiteCaseResult[]
  errorOutput: string
}

function parseBunTestOutput(stdout: string, stderr: string): ParsedOutput {
  const cases: SuiteCaseResult[] = []
  const lines = (stdout + "\n" + stderr).split("\n")
  let passed = 0
  let failed = 0
  let skipped = 0
  let todo = 0

  // Bun test output lines look like:
  //   (pass) MyTest > does the thing [12.34ms]
  //   (fail) MyTest > breaks [1ms]
  //   (skip) MyTest > pending
  //   (todo) MyTest > later
  for (const raw of lines) {
    const line = raw.trim()
    const m = /^\((pass|fail|skip|todo)\)\s+(.+?)(?:\s+\[([0-9.]+)(ms|s)\])?$/.exec(line)
    if (m) {
      const status = m[1] as SuiteCaseResult["status"]
      const name = m[2]!
      const dur = m[3] ? parseFloat(m[3]) * (m[4] === "s" ? 1000 : 1) : undefined
      cases.push({ name, status, durationMs: dur })
      if (status === "pass") passed++
      else if (status === "fail") failed++
      else if (status === "skip") skipped++
      else if (status === "todo") todo++
    }
  }

  // Summary fallback: "X pass\n Y fail\n Z skip"
  const summaryPass = /(\d+)\s+pass/.exec(stdout) ?? /(\d+)\s+pass/.exec(stderr)
  const summaryFail = /(\d+)\s+fail/.exec(stdout) ?? /(\d+)\s+fail/.exec(stderr)
  const summarySkip = /(\d+)\s+skip/.exec(stdout) ?? /(\d+)\s+skip/.exec(stderr)
  if (passed === 0 && summaryPass) passed = parseInt(summaryPass[1]!, 10)
  if (failed === 0 && summaryFail) failed = parseInt(summaryFail[1]!, 10)
  if (skipped === 0 && summarySkip) skipped = parseInt(summarySkip[1]!, 10)

  // Attach error messages to failed cases (look for "error: ..." or " | path:line:col" blocks)
  const errBlocks: string[] = []
  let cur: string[] = []
  for (const raw of lines) {
    if (/^\s*(error:|Expected|Received|at\s)/.test(raw)) cur.push(raw)
    else if (cur.length > 0 && raw.trim() === "") {
      errBlocks.push(cur.join("\n"))
      cur = []
    }
  }
  if (cur.length > 0) errBlocks.push(cur.join("\n"))

  const failedCases = cases.filter((c) => c.status === "fail")
  for (let i = 0; i < failedCases.length && i < errBlocks.length; i++) {
    failedCases[i]!.errorMessage = errBlocks[i]
  }

  return {
    totalTests: passed + failed + skipped + todo,
    passed,
    failed,
    skipped,
    todo,
    cases,
    errorOutput: stderr.slice(0, 4000),
  }
}

function deriveStatus(p: ParsedOutput, exitCode: number): SuiteExecStatus {
  if (exitCode !== 0 || p.failed > 0) return "fail"
  if (p.passed > 0 && p.skipped > 0) return "mixed"
  if (p.passed > 0) return "pass"
  if (p.skipped > 0) return "skip"
  if (p.todo > 0) return "todo"
  return "notrun"
}

export async function runTestFile(filePath: string, callbacks: SuiteRunnerCallbacks): Promise<SuiteRunResult> {
  const rel = filePath.replace(TARGET_PACKAGE_ROOT, "").replace(/^\//, "")
  const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}__${rel.replace(/[^a-z0-9]+/gi, "-").slice(0, 80)}`
  const startedAt = Date.now()
  callbacks.onStart(runId)
  callbacks.onStateChange("running")
  callbacks.onLog(`▶ bun test ${rel}\n`)

  const proc = Bun.spawn([process.execPath, "test", rel], {
    cwd: TARGET_PACKAGE_ROOT,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, FORCE_COLOR: "0" },
  })

  const [stdout, stderr] = await Promise.all([pipe(proc.stdout, callbacks.onLog), pipe(proc.stderr, callbacks.onLog)])
  const exitCode = await proc.exited
  const durationMs = Date.now() - startedAt

  const parsed = parseBunTestOutput(stdout, stderr)
  const status = deriveStatus(parsed, exitCode)
  const result: SuiteRunResult = {
    filePath,
    relativePath: rel,
    runId,
    startedAt,
    durationMs,
    status,
    exitCode,
    totalTests: parsed.totalTests,
    passed: parsed.passed,
    failed: parsed.failed,
    skipped: parsed.skipped,
    todo: parsed.todo,
    cases: parsed.cases,
    errorOutput: parsed.errorOutput,
  }

  callbacks.onLog(
    `\n${status === "pass" ? "✓" : status === "fail" ? "✗" : "•"} ${rel} — ${parsed.passed}p / ${parsed.failed}f / ${parsed.skipped}s in ${durationMs}ms\n`,
  )
  callbacks.onStateChange(status === "fail" ? "error" : "success", exitCode)
  callbacks.onResult(result)
  callbacks.onDone()
  return result
}

export async function runTestGroup(
  filePaths: string[],
  callbacks: SuiteRunnerCallbacks,
  opts?: { stopOnFail?: boolean; concurrency?: number },
): Promise<SuiteRunResult[]> {
  const results: SuiteRunResult[] = []
  const stopOnFail = opts?.stopOnFail ?? false
  for (const fp of filePaths) {
    const r = await runTestFile(fp, callbacks)
    results.push(r)
    if (stopOnFail && r.status === "fail") break
  }
  return results
}

export async function ensureHistoryDir(): Promise<void> {
  await fs.mkdir(SUITE_HISTORY_DIR, { recursive: true })
}

function historyFileFor(relativePath: string): string {
  const safe = relativePath.replace(/[^a-zA-Z0-9._-]+/g, "_")
  return path.join(SUITE_HISTORY_DIR, `${safe}.json`)
}

export async function loadHistoryFor(relativePath: string): Promise<SuiteRunResult[]> {
  try {
    const buf = await fs.readFile(historyFileFor(relativePath), "utf8")
    const parsed = JSON.parse(buf) as SuiteRunResult[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export async function appendHistory(result: SuiteRunResult, max = 25): Promise<void> {
  await ensureHistoryDir()
  const prior = await loadHistoryFor(result.relativePath)
  const next = [...prior, result].slice(-max)
  await fs.writeFile(historyFileFor(result.relativePath), JSON.stringify(next, null, 2))
}

export async function loadAllHistory(): Promise<Map<string, SuiteRunResult[]>> {
  await ensureHistoryDir()
  const map = new Map<string, SuiteRunResult[]>()
  try {
    const files = await fs.readdir(SUITE_HISTORY_DIR)
    for (const fn of files) {
      if (!fn.endsWith(".json")) continue
      try {
        const buf = await fs.readFile(path.join(SUITE_HISTORY_DIR, fn), "utf8")
        const parsed = JSON.parse(buf) as SuiteRunResult[]
        if (Array.isArray(parsed) && parsed.length > 0) {
          map.set(parsed[parsed.length - 1]!.relativePath, parsed)
        }
      } catch {}
    }
  } catch {}
  return map
}

export async function clearHistoryFor(relativePath: string): Promise<void> {
  try {
    await fs.unlink(historyFileFor(relativePath))
  } catch {}
}
