import fs from "fs/promises"
import type { RunnerState } from "../types"
import { OUTPUT_DIR, TARGET_PACKAGE_ROOT, TEST_PATTERNS, USER_ARGS } from "../types"

export interface RunnerCallbacks {
  onLog: (chunk: string) => void
  onStateChange: (state: RunnerState, exitCode?: number) => void
  onStart: (runId: string) => void
  onDone: () => void
}

async function pipeOutput(
  stream: ReadableStream<Uint8Array> | null,
  onLog: (chunk: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  if (!stream) return
  const reader = stream.getReader()
  const dec = new TextDecoder()
  try {
    while (true) {
      if (signal?.aborted) break
      const r = await reader.read()
      if (r.done) break
      onLog(dec.decode(r.value, { stream: true }))
    }
  } finally {
    reader.releaseLock()
  }
}

function sanitizeOutput(line: string): string {
  return line
    .replace(/\r/g, "")
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "")
    .replace(/\x1b\][0-9;]*[^\x1b]*(\x1b\\|\x07)/g, "")
}

export async function runBenchmarks(callbacks: RunnerCallbacks, baselinePath?: string): Promise<void> {
  const runId = new Date().toISOString().replace(/[:.]/g, "-")
  callbacks.onStart(runId)
  callbacks.onStateChange("running")

  const cmd =
    USER_ARGS.length > 0 ? [process.execPath, "test", ...TEST_PATTERNS] : [process.execPath, "run", "test:bench:run"]
  callbacks.onLog(`\u25b6 ${cmd.slice(1).join(" ")}`)

  await fs.mkdir(OUTPUT_DIR, { recursive: true })

  const proc = Bun.spawn(cmd, {
    cwd: TARGET_PACKAGE_ROOT,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      FORCE_COLOR: "0",
      NIKCLI_BENCHMARK_SAVE: "1",
      NIKCLI_BENCHMARK_RUN_ID: runId,
      NIKCLI_BENCHMARK_OUTPUT_DIR: OUTPUT_DIR,
      ...(baselinePath ? { NIKCLI_BENCHMARK_BASELINE_PATH: baselinePath } : {}),
    },
  })

  const exitPromise = proc.exited

  await Promise.all([
    pipeOutput(proc.stdout, (chunk) => callbacks.onLog(sanitizeOutput(chunk))),
    pipeOutput(proc.stderr, (chunk) => callbacks.onLog(sanitizeOutput(chunk))),
  ])

  const code = await exitPromise
  callbacks.onLog(`\n${code === 0 ? "\u2713" : "\u2717"} Done (exit ${code})`)
  callbacks.onStateChange(code === 0 ? "success" : "error", code)
  callbacks.onDone()
}

export async function runSingleBenchmark(
  filePath: string,
  callbacks: RunnerCallbacks,
  baselinePath?: string,
): Promise<void> {
  const rel = filePath.replace(TARGET_PACKAGE_ROOT, "").replace(/^\//, "")
  const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}__${rel.replace(/[^a-z0-9]+/gi, "-").slice(0, 80)}`
  callbacks.onStart(runId)
  callbacks.onStateChange("running")
  callbacks.onLog(`\u25b6 bun test ${rel}`)

  await fs.mkdir(OUTPUT_DIR, { recursive: true })

  const proc = Bun.spawn([process.execPath, "test", rel], {
    cwd: TARGET_PACKAGE_ROOT,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      FORCE_COLOR: "0",
      NIKCLI_BENCHMARK_SAVE: "1",
      NIKCLI_BENCHMARK_RUN_ID: runId,
      NIKCLI_BENCHMARK_OUTPUT_DIR: OUTPUT_DIR,
      ...(baselinePath ? { NIKCLI_BENCHMARK_BASELINE_PATH: baselinePath } : {}),
    },
  })

  const exitPromise = proc.exited

  await Promise.all([
    pipeOutput(proc.stdout, (chunk) => callbacks.onLog(sanitizeOutput(chunk))),
    pipeOutput(proc.stderr, (chunk) => callbacks.onLog(sanitizeOutput(chunk))),
  ])

  const code = await exitPromise
  callbacks.onLog(`\n${code === 0 ? "\u2713" : "\u2717"} Done (exit ${code})`)
  callbacks.onStateChange(code === 0 ? "success" : "error", code)
  callbacks.onDone()
}
