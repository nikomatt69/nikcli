import { afterAll, describe, expect, it } from "bun:test"
import { Provider } from "@/provider/provider"
import { FormatError, FormatUnknownError } from "@/cli/error"
import { parseGitHubRemote } from "@/cli/cmd/github"
import { flushBenchmarkRun, recordBenchmark } from "../benchmarks/runner"

afterAll(async () => {
  await flushBenchmarkRun()
})

describe("cli parse/format micro-benchmarks", () => {
  it("parseGitHubRemote hot loop", () => {
    const url = "https://github.com/foo/bar.git"
    const iterations = 50_000
    const warmup = 1_000
    for (let i = 0; i < warmup; i++) parseGitHubRemote(url)
    const start = performance.now()
    for (let i = 0; i < iterations; i++) parseGitHubRemote(url)
    const elapsed = performance.now() - start
    recordBenchmark({
      suite: "cli",
      module: "github",
      scenario: "parseGitHubRemote loop",
      iterations,
      value: elapsed,
      unit: "ms",
    })
    expect(elapsed).toBeGreaterThanOrEqual(0)
  })

  it("FormatError known errors hot loop", () => {
    const err = new Provider.ModelNotFoundError({ providerID: "p", modelID: "m" })
    const iterations = 20_000
    const warmup = 500
    for (let i = 0; i < warmup; i++) FormatError(err)
    const start = performance.now()
    for (let i = 0; i < iterations; i++) FormatError(err)
    const elapsed = performance.now() - start
    recordBenchmark({
      suite: "cli",
      module: "error",
      scenario: "FormatError ModelNotFound loop",
      iterations,
      value: elapsed,
      unit: "ms",
    })
    expect(elapsed).toBeGreaterThanOrEqual(0)
  })

  it("FormatUnknownError Error hot loop", () => {
    const err = new Error("bench")
    const iterations = 50_000
    const warmup = 1_000
    for (let i = 0; i < warmup; i++) FormatUnknownError(err)
    const start = performance.now()
    for (let i = 0; i < iterations; i++) FormatUnknownError(err)
    const elapsed = performance.now() - start
    recordBenchmark({
      suite: "cli",
      module: "error",
      scenario: "FormatUnknownError Error loop",
      iterations,
      value: elapsed,
      unit: "ms",
    })
    expect(elapsed).toBeGreaterThanOrEqual(0)
  })
})
