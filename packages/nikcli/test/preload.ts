import "@opentui/solid/preload"
import { afterAll } from "bun:test"

const shouldFlushBenchmarks =
  process.env.NIKCLI_BENCHMARK_SAVE === "1" ||
  process.env.NIKCLI_BENCHMARK_COMPARE === "1" ||
  Boolean(process.env.NIKCLI_BENCHMARK_BASELINE_PATH)

if (shouldFlushBenchmarks) {
  afterAll(async () => {
    const { flushBenchmarkRun } = await import("./benchmarks/runner")
    await flushBenchmarkRun()
  })
}
