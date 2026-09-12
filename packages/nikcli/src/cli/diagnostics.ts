import fs from "fs/promises"
import path from "path"
import { Global } from "@nikcli-ai/util/global"
import { Log } from "@nikcli-ai/util/log"

const log = Log.create({ service: "diagnostics" })

/**
 * On-demand profiling of a *running* nikcli process, armed by OS signal.
 *
 * `nikcli heap` only reports metrics for the short-lived process that runs the
 * command, which says nothing about the session that is actually misbehaving.
 * Every prior CPU or memory investigation here therefore had to reproduce the
 * problem under a purpose-built harness — and the interactive streaming path,
 * the one users feel, was never profiled at all because there was no way to
 * reach into a live TUI.
 *
 * Ported from opencode v2 (`packages/cli/src/{heap,cpu-profile}.ts`), which arms
 * the same two signals in every process it starts:
 *
 *   kill -USR1 <pid>   ->  heap snapshot   (.heapsnapshot, open in DevTools)
 *   kill -PROF <pid>   ->  10s CPU profile (.cpuprofile,   open in DevTools)
 *
 * Both land in `Global.Path.log` next to the logs, named by pid and timestamp.
 * Arming costs one signal listener and nothing else until a signal arrives, so
 * it is on in normal runs — the whole point is to profile the session the user
 * is already complaining about, not a reproduction of it.
 *
 * Scope caveat worth knowing before reading a capture: signals are delivered to
 * the main thread, and a CPU profile covers the isolate it was started in. The
 * TUI runs its session in a worker thread, so `listen` is armed separately there
 * (see `cli/cmd/tui/worker.ts`) — profile the worker for session/streaming work
 * and the main thread for render work. RSS in a heap snapshot is process-wide
 * either way.
 */
export namespace Diagnostics {
  const CPU_PROFILE_MS = 10_000

  let armed = false
  /**
   * Per-kind, not one global flag: a heap snapshot and a CPU profile are
   * independent captures, and a shared flag silently swallowed a `SIGPROF` sent
   * while a snapshot was still being written — which is exactly how you use
   * these two together.
   */
  const capturing = new Set<string>()

  function stamp(kind: string, extension: string) {
    const name = `${kind}-${process.pid}-${new Date().toISOString().replace(/[:.]/g, "")}.${extension}`
    return path.join(Global.Path.log, name)
  }

  async function heapSnapshot() {
    const file = stamp("heap", "heapsnapshot")
    try {
      await fs.mkdir(path.dirname(file), { recursive: true })
      const { writeHeapSnapshot } = await import("v8")
      writeHeapSnapshot(file)
      log.info("heap snapshot written", { path: file })
    } catch (error) {
      log.error("failed to write heap snapshot", { path: file, error })
    }
  }

  async function cpuProfile() {
    const file = stamp("cpu", "cpuprofile")
    const { Session } = await import("inspector")
    const session = new Session()
    const post = (method: string) =>
      new Promise<any>((resolve, reject) => {
        session.post(method as never, (error: unknown, result: unknown) => (error ? reject(error) : resolve(result)))
      })
    try {
      await fs.mkdir(path.dirname(file), { recursive: true })
      session.connect()
      await post("Profiler.enable")
      await post("Profiler.start")
      log.info("cpu profile started", { path: file, durationMs: CPU_PROFILE_MS })
      await new Promise((resolve) => setTimeout(resolve, CPU_PROFILE_MS))
      const result = await post("Profiler.stop")
      await Bun.write(file, JSON.stringify(result.profile))
      log.info("cpu profile written", { path: file })
    } catch (error) {
      log.error("failed to capture cpu profile", { path: file, error })
    } finally {
      try {
        session.disconnect()
      } catch {}
    }
  }

  /**
   * Install the signal handlers. Idempotent, and a no-op on Windows, which has
   * neither signal. Returns a disposer for entrypoints that need one.
   */
  export function listen(): () => void {
    if (armed || process.platform === "win32") return () => {}
    armed = true

    // A capture of the same kind already in flight swallows the signal rather
    // than queuing it: two concurrent profilers would measure each other.
    const once = (kind: string, capture: () => Promise<void>) => () => {
      if (capturing.has(kind)) {
        log.warn("diagnostics capture already in progress, ignoring signal", { kind })
        return
      }
      capturing.add(kind)
      void capture().finally(() => {
        capturing.delete(kind)
      })
    }

    const onHeap = once("heap", heapSnapshot)
    const onCpu = once("cpu", cpuProfile)
    process.on("SIGUSR1", onHeap)
    process.on("SIGPROF", onCpu)

    return () => {
      process.off("SIGUSR1", onHeap)
      process.off("SIGPROF", onCpu)
      armed = false
    }
  }
}
