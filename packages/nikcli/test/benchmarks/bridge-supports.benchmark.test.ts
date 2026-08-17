import { describe, expect, it } from "bun:test"
import { HttpApiBridge } from "@/server/httpapi/bridge"
import { recordBenchmark } from "./runner"

/**
 * `HttpApiBridge.supports` runs on every request that reaches
 * `ServerRouter.dispatch`, before the fallback decision. The route table is
 * grouped by method at module load; these scenarios pin the per-call cost so
 * a route-table edit (or a regression back to a flat scan) shows up in
 * `bun run test:bench`.
 *
 * The mix mirrors real traffic: hot GET hits (`/event`, `/session/*`), a
 * share of POSTs, and ~20% misses — misses are the worst case because they
 * scan the whole method bucket before `Server.fallback` takes over.
 */
describe("HttpApiBridge.supports benchmark", () => {
  const hits: Array<[string, string]> = [
    ["/event", "GET"],
    ["/session", "GET"],
    ["/session/ses_abc123/diff", "GET"],
    ["/session/ses_abc123/message", "GET"],
    ["/session/ses_abc123/message", "POST"],
    ["/session/ses_abc123/prompt_async", "POST"],
    ["/config", "GET"],
    ["/tui/publish", "POST"],
    ["/log", "POST"],
    ["/pty/pty_abc123", "GET"],
    ["/mobile/loops", "GET"],
    ["/sync/stats", "GET"],
  ]
  // Paths that resolve to `options.fallback` (website proxy) — full-bucket scans.
  const misses: Array<[string, string]> = [
    ["/", "GET"],
    ["/session/ses_abc123/unknown", "GET"],
    ["/docs/getting-started", "GET"],
    ["/session/ses_abc123", "OPTIONS"],
  ]

  function run(scenario: string, mix: Array<[string, string]>, iterations: number) {
    const warmup = Math.max(10_000, Math.floor(iterations / 10))
    for (let i = 0; i < warmup; i++) {
      const [path, method] = mix[i % mix.length]
      HttpApiBridge.supports(path, method)
    }
    // Two measured rounds; the first absorbs residual JIT tiering under the
    // bun:test harness, the second is the recorded steady state.
    let elapsed = 0
    let matched = 0
    for (let round = 0; round < 2; round++) {
      const start = performance.now()
      matched = 0
      for (let i = 0; i < iterations; i++) {
        const [path, method] = mix[i % mix.length]
        if (HttpApiBridge.supports(path, method)) matched++
      }
      elapsed = performance.now() - start
    }
    const perOp = elapsed / iterations

    console.log(`\n📊 HttpApiBridge.supports — ${scenario} (${iterations} iterations):`)
    console.log(`   Total: ${elapsed.toFixed(2)}ms`)
    console.log(`   Per op: ${(perOp * 1000).toFixed(2)}µs`)

    recordBenchmark({
      suite: "server",
      module: "httpapi-bridge",
      scenario: `supports ${scenario}`,
      iterations,
      value: elapsed,
      unit: "ms",
      metadata: { matched },
    })

    // Loose guard against orders-of-magnitude regressions only; steady state
    // is ~2-3µs/op, and shared CI hardware flakes on tighter budgets.
    expect(perOp).toBeLessThan(0.05)
  }

  it("hot-path hits", () => {
    run("hits", hits, 100_000)
  })

  it("miss-heavy fallback traffic", () => {
    run("misses", misses, 100_000)
  })

  it("realistic mix (80% hits, 20% misses)", () => {
    const mix = [...hits, ...hits, ...misses]
    run("mixed", mix, 100_000)
  })

  it("supportsGlobal", () => {
    const mix: Array<[string, string]> = [
      ["/global/health", "GET"],
      ["/global/event", "GET"],
      ["/user/me", "GET"],
      ["/user/login", "POST"],
      ["/user/usr_abc", "PATCH"],
      ["/unknown", "GET"],
    ]
    const iterations = 100_000
    let elapsed = 0
    for (let round = 0; round < 2; round++) {
      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        const [path, method] = mix[i % mix.length]
        HttpApiBridge.supportsGlobal(path, method)
      }
      elapsed = performance.now() - start
    }
    const perOp = elapsed / iterations

    console.log(`\n📊 HttpApiBridge.supportsGlobal (${iterations} iterations):`)
    console.log(`   Total: ${elapsed.toFixed(2)}ms`)
    console.log(`   Per op: ${(perOp * 1000).toFixed(2)}µs`)

    recordBenchmark({
      suite: "server",
      module: "httpapi-bridge",
      scenario: "supportsGlobal mixed",
      iterations,
      value: elapsed,
      unit: "ms",
    })

    expect(perOp).toBeLessThan(0.05)
  })

  it("method bucket guard: unknown method short-circuits", () => {
    expect(HttpApiBridge.supports("/event", "TRACE")).toBe(false)
    expect(HttpApiBridge.supportsGlobal("/global/health", "TRACE")).toBe(false)
  })
})
