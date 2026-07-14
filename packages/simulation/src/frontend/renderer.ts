import type { CliRenderer, CliRendererConfig } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { Timeline } from "../recording"

type TestRendererSetup = Awaited<ReturnType<typeof createTestRenderer>>

const setups = new WeakMap<CliRenderer, TestRendererSetup>()
const recordings = new WeakMap<CliRenderer, Timeline>()

export interface Viewport {
  readonly cols: number
  readonly rows: number
}

/** Create a real OpenTUI renderer backed by an in-memory terminal. */
export async function create(options: CliRendererConfig, path?: string, viewport?: Viewport): Promise<CliRenderer> {
  const cols = viewport?.cols ?? 100
  const rows = viewport?.rows ?? 40
  if (!path) {
    const setup = await createTestRenderer({ ...options, width: cols, height: rows })
    setups.set(setup.renderer, setup)
    return setup.renderer
  }

  const recording = await Timeline.create(path, cols, rows)
  const setup = await createTestRenderer({
    ...options,
    width: cols,
    height: rows,
    stdout: recording as unknown as NodeJS.WriteStream,
    onDestroy: () => {
      void recording.finish().catch((error) => process.stderr.write(`Failed to finish UI recording: ${error}\n`))
      options.onDestroy?.()
    },
  }).catch(async (error) => {
    await recording.finish().catch(() => undefined)
    throw error
  })
  setups.set(setup.renderer, setup)
  recordings.set(setup.renderer, recording)
  return setup.renderer
}

export function recordResize(renderer: CliRenderer, cols: number, rows: number) {
  recordings.get(renderer)?.resize(cols, rows)
}

export function setupFor(renderer: CliRenderer): TestRendererSetup | undefined {
  return setups.get(renderer)
}

export function finish(renderer: CliRenderer) {
  const recording = recordings.get(renderer)
  if (!recording) throw new Error("UI recording is not available")
  return recording.finish()
}

export * as SimulationRenderer from "./renderer"
