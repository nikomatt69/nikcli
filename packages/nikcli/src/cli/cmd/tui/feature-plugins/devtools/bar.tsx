/**
 * A one-line readout of how the runtime is actually doing.
 *
 * ```
 * ○ 4ms  ⣀⣠⣤⣶⣿⣶⣤⣠⣀⣀⣀⣀  cpu 12%  rss 312 MB
 * ```
 *
 * The number that matters is the first one: 99th-percentile **event loop
 * delay**. A TUI paints on a loop, so anything that keeps the loop busy delays
 * the next frame — and that, not CPU load, is what "the stream feels less
 * fluid" actually is. A whole-message re-scan per token barely moves the CPU
 * figure while pushing the delay from 4 ms to 60.
 *
 * It exists because the alternative is what we did instead: describe the
 * feeling, guess a cause, write a synthetic benchmark, and find out the guess
 * was wrong. This puts the measurement in front of the person who can see the
 * jank, while it is happening.
 *
 * The arithmetic lives in `util/runtime-samples.ts`, where it is tested.
 * Adapted from opencode v2's `DevToolsBar`, reduced to the runtime panel —
 * their server/theme/tool panels describe a data layer we do not have.
 */
import { monitorEventLoopDelay } from "node:perf_hooks"
import { createMemo, createSignal, onCleanup, onMount, Show } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { useKV } from "@tui/context/kv"
import {
  brailleGraph,
  cpuPercent,
  formatBytes,
  retain,
  runtimeStatus,
  statusIcon,
  SAMPLE_INTERVAL_MS,
  type RuntimeSample,
} from "@tui/util/runtime-samples"
import { readEnabled } from "./store"

const GRAPH_WIDTH = 23

export function DevToolsBar() {
  const kv = useKV()
  const enabled = createMemo(() => readEnabled(kv))
  return (
    <Show when={enabled()}>
      <Readout />
    </Show>
  )
}

/**
 * Split from {@link DevToolsBar} so the sampler is mounted by the `<Show>` and
 * torn down with it. Sampling only while the bar is visible is what makes the
 * feature free when it is off.
 */
function Readout() {
  const { theme } = useTheme()
  const [samples, setSamples] = createSignal<readonly RuntimeSample[]>([])

  onMount(() => {
    // 20µs resolution: fine enough that a dropped frame registers, coarse
    // enough that the histogram itself is not part of the problem.
    const loop = monitorEventLoopDelay({ resolution: 20 })
    loop.enable()
    let previousCPU = process.cpuUsage()
    let previousTime = performance.now()
    // The first interval covers process startup, which is not a steady-state
    // reading and would leave a spike at the left of the graph forever.
    let settled = false

    const sample = () => {
      const now = performance.now()
      const cpu = process.cpuUsage(previousCPU)
      previousCPU = process.cpuUsage()
      setSamples((previous) =>
        retain(
          [
            ...previous,
            {
              cpu: settled ? cpuPercent(cpu.user + cpu.system, now - previousTime) : 0,
              memory: process.memoryUsage().rss,
              delay: loop.percentile(99) / 1_000_000,
              time: now,
            },
          ],
          now,
        ),
      )
      loop.reset()
      settled = true
      previousTime = now
    }

    sample()
    const timer = setInterval(sample, SAMPLE_INTERVAL_MS)
    onCleanup(() => {
      clearInterval(timer)
      loop.disable()
    })
  })

  const latest = createMemo(() => samples().at(-1))
  const status = createMemo(() => runtimeStatus(samples()))
  const graph = createMemo(() =>
    brailleGraph(
      samples().map((sample) => sample.delay),
      GRAPH_WIDTH,
    ),
  )
  const color = createMemo(() => {
    const current = status()
    if (current === "high") return theme.error
    if (current === "medium") return theme.warning
    return theme.textMuted
  })

  return (
    <box flexDirection="row" gap={1} flexShrink={0} paddingLeft={1} paddingRight={1}>
      <text fg={color()}>
        {statusIcon(status())} {Math.round(latest()?.delay ?? 0)}ms
      </text>
      <text fg={theme.textMuted}>{graph()}</text>
      <text fg={theme.textMuted}>cpu {Math.round(latest()?.cpu ?? 0)}%</text>
      <text fg={theme.textMuted}>rss {formatBytes(latest()?.memory ?? 0)}</text>
    </box>
  )
}
