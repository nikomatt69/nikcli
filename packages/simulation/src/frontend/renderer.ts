import type { CliRenderer, CliRendererConfig } from "@opentui/core"
import { createTestRenderer as ownCreateTestRenderer } from "@opentui/core/testing"
import { Timeline } from "../recording"

type TestRendererSetup = Awaited<ReturnType<typeof ownCreateTestRenderer>>

const setups = new WeakMap<CliRenderer, TestRendererSetup>()
const recordings = new WeakMap<CliRenderer, Timeline>()

export interface Viewport {
  readonly cols: number
  readonly rows: number
}

/**
 * Renderer constructors supplied by the host process.
 *
 * The renderer must be built from the *host's* `@opentui/core` module instance,
 * not this package's. `@opentui/solid`'s `render(node, rendererOrConfig)` decides
 * whether to reuse a renderer with `rendererOrConfig instanceof CliRenderer`; when
 * bun resolves two physical copies of `@opentui/core` (this package and the host
 * get different entries in `node_modules/.bun`), that check silently fails and
 * Solid builds a *second* renderer — which since 0.4.x dies with
 * "Cannot create CliRenderer: stdin is already used by another CliRenderer".
 */
export interface HostRuntime {
  readonly createTestRenderer: typeof ownCreateTestRenderer
}

/** Create a real OpenTUI renderer backed by an in-memory terminal. */
export async function create(
  options: CliRendererConfig,
  path?: string,
  viewport?: Viewport,
  host?: HostRuntime,
): Promise<CliRenderer> {
  const createTestRenderer = host?.createTestRenderer ?? ownCreateTestRenderer
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
