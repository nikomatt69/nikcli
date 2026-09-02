import { describe, expect, it } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { recordBenchmark } from "./runner"

/**
 * What does `InstanceBootstrap` cost for a directory nobody asked to
 * bootstrap?
 *
 * This is the measurement R1's last open clause waits on. `withInstanceAsync`
 * can only lose its `init` path once bootstrap is unconditional, and bootstrap
 * can only become unconditional once the marginal cost of running it on every
 * directory an acquisition touches is known. Today ~15 call sites pass
 * `InstanceBootstrap` and ~20 do not, and the ones that do not include paths
 * that touch many directories — `server/mobile/git.ts` acquires per repo, and
 * `server/mobile/session.ts` acquires a freshly created git worktree per
 * session.
 *
 * Every directory here is a real git repository with a commit, because the
 * shape that matters is a session worktree: `FileWatcher` subscribes only for
 * `vcs === "git"` projects, so a non-git temp dir would measure the cheap case
 * and answer the wrong question.
 *
 * **The average is the wrong statistic here and reporting it would drive the
 * wrong decision.** Bootstrap lazily imports the brain scheduler, the sync
 * projectors, the v2 session projector and the remote-sync init, so the first
 * directory pays for a module graph every later one reuses. Averaged over a
 * handful of directories that one-time cost is indistinguishable from a
 * per-directory cost — measured over 6 directories it reads as ~20MB/dir, over
 * 8 as ~7.6MB/dir, which is the signature of a constant divided by N. So this
 * records resident memory after *each* directory and reports the slope across
 * the tail; only the slope is a per-directory cost.
 *
 * Bootstrap also fires most of its work in the background on purpose, so each
 * directory gets a settle window before its measurement — what a long-lived
 * server pays is the steady state, not the synchronous return.
 */
describe("InstanceBootstrap cost per directory", () => {
  const COUNT = Number(process.env.NIKCLI_BOOTSTRAP_BENCH_COUNT ?? "8")
  const SETTLE_MS = 1500

  async function gitRepo(dir: string) {
    await Bun.$`git init -q ${dir}`.quiet()
    await fs.writeFile(path.join(dir, "README.md"), "# bench\n")
    await Bun.$`git -C ${dir} add -A`.quiet()
    await Bun.$`git -C ${dir} -c user.email=b@b -c user.name=b commit -qm init`.quiet()
  }

  function childCount() {
    const out = Bun.spawnSync(["pgrep", "-P", String(process.pid)])
      .stdout.toString()
      .trim()
    return out ? out.split("\n").filter(Boolean).length : 0
  }

  const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

  /** Least-squares slope of y over the index, in KB per directory. */
  function slopeKB(samples: number[]) {
    const n = samples.length
    if (n < 2) return 0
    const meanX = (n - 1) / 2
    const meanY = samples.reduce((a, b) => a + b, 0) / n
    let num = 0
    let den = 0
    for (let i = 0; i < n; i++) {
      num += (i - meanX) * (samples[i]! - meanY)
      den += (i - meanX) ** 2
    }
    return num / den / 1024
  }

  it("separates the one-time module graph from the per-directory cost", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-bootcost-home-"))
    process.env.NIKCLI_TEST_HOME = home
    process.env.NIKCLI_DISABLE_PROJECT_CONFIG = "1"

    const { Instance } = await import("@/project/instance")
    const { InstanceBootstrap } = await import("@/project/bootstrap")

    const cleanup: string[] = [home]

    async function measure(label: string, bootstrap: boolean) {
      const dirs: string[] = []
      for (let i = 0; i < COUNT; i++) {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), `nikcli-bootcost-${label}-`))
        await gitRepo(dir)
        dirs.push(dir)
        cleanup.push(dir)
      }

      Bun.gc(true)
      await settle(500)
      const rssBefore = process.memoryUsage().rss
      const childrenBefore = childCount()

      const times: number[] = []
      const rssAfter: number[] = []
      for (const dir of dirs) {
        const start = performance.now()
        await Instance.provide({
          directory: dir,
          init: bootstrap ? InstanceBootstrap : undefined,
          fn: async () => {},
        })
        times.push(performance.now() - start)
        await settle(SETTLE_MS)
        Bun.gc(true)
        rssAfter.push(process.memoryUsage().rss)
      }

      // The tail excludes the first directory, which carries the lazy module
      // graph; its slope is the per-directory cost.
      const tail = rssAfter.slice(1)
      const steadyPerDirKB = slopeKB(tail)
      const oneTimeKB = (rssAfter[0]! - rssBefore) / 1024 - steadyPerDirKB
      const steadyMs = times.slice(1).reduce((a, b) => a + b, 0) / Math.max(1, times.length - 1)

      return {
        perDirMs: times.reduce((a, b) => a + b, 0) / times.length,
        steadyMs,
        firstMs: times[0]!,
        naiveRssPerDirKB: (rssAfter[rssAfter.length - 1]! - rssBefore) / dirs.length / 1024,
        steadyPerDirKB,
        oneTimeKB,
        childrenPerDir: (childCount() - childrenBefore) / dirs.length,
        times,
        rssMB: rssAfter.map((v) => v / 1024 / 1024),
      }
    }

    const off = await measure("no-init", false)
    const on = await measure("bootstrap", true)

    const f = (n: number) => n.toFixed(1)
    console.log(`\n📊 InstanceBootstrap per directory (${COUNT} fresh git repos, ${SETTLE_MS}ms settle each):`)
    console.log(
      `   without init : first ${f(off.firstMs)}ms then ${f(off.steadyMs)}ms/dir   steady rss ${f(off.steadyPerDirKB)}KB/dir`,
    )
    console.log(
      `   with init    : first ${f(on.firstMs)}ms then ${f(on.steadyMs)}ms/dir   steady rss ${f(on.steadyPerDirKB)}KB/dir`,
    )
    console.log(
      `   steady margin: +${f(on.steadyMs - off.steadyMs)}ms/dir  +${f(on.steadyPerDirKB - off.steadyPerDirKB)}KB/dir  +${(on.childrenPerDir - off.childrenPerDir).toFixed(2)} child processes/dir`,
    )
    console.log(`   one-time     : ~${f(on.oneTimeKB / 1024)}MB on the first bootstrap (lazy module graph)`)
    console.log(`   naive avg    : ${f(on.naiveRssPerDirKB)}KB/dir — the statistic that misleads, kept to show it`)
    console.log(`   rss after n  : ${on.rssMB.map((v) => f(v)).join(", ")} MB`)
    console.log(`   ms per dir   : ${on.times.map(f).join(", ")}`)

    for (const [scenario, result] of [
      ["acquire-without-init", off],
      ["acquire-with-bootstrap", on],
    ] as const) {
      recordBenchmark({
        suite: "instance",
        module: "project/bootstrap",
        scenario,
        iterations: COUNT,
        value: result.steadyMs,
        unit: "ms",
        valuePerIteration: result.steadyMs,
        metadata: {
          steadyRssPerDirKB: Number(result.steadyPerDirKB.toFixed(1)),
          oneTimeKB: Number(result.oneTimeKB.toFixed(1)),
          naiveRssPerDirKB: Number(result.naiveRssPerDirKB.toFixed(1)),
          firstMs: Number(result.firstMs.toFixed(1)),
          childrenPerDir: Number(result.childrenPerDir.toFixed(2)),
          settleMs: SETTLE_MS,
        },
      })
    }

    await Instance.disposeAll()
    for (const dir of cleanup) await fs.rm(dir, { recursive: true, force: true }).catch(() => {})

    // Not a threshold — the harness has to have actually done the work for
    // the recorded numbers to mean anything.
    expect(on.times).toHaveLength(COUNT)
    expect(off.times).toHaveLength(COUNT)
  }, 300_000)
})
