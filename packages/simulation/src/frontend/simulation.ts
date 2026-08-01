import { createCliRenderer as ownCreateCliRenderer, type CliRenderer, type CliRendererConfig } from "@opentui/core"
import { DriveManifest } from "../manifest"
import { SimulationActions } from "./actions"
import { SimulationRenderer, type HostRuntime as RendererHostRuntime } from "./renderer"
import { SimulationServer } from "./server"

/**
 * The host's OpenTUI entry points. See {@link RendererHostRuntime} for why the
 * renderer has to be constructed from the caller's module instance.
 */
export interface HostRuntime extends RendererHostRuntime {
  readonly createCliRenderer: typeof ownCreateCliRenderer
}

/** Create the visible or headless renderer and expose its deterministic drive API. */
export async function create(options: CliRendererConfig, host?: HostRuntime): Promise<CliRenderer> {
  const createCliRenderer = host?.createCliRenderer ?? ownCreateCliRenderer
  const headless = process.env.NIKCLI_DRIVE_RENDERER === "headless"
  const manifest = DriveManifest.resolve()
  const renderer = headless
    ? await SimulationRenderer.create(options, manifest.recording?.timeline, manifest.viewport, host)
    : await createCliRenderer(options)
  if (!headless && manifest.viewport) {
    const harness = SimulationActions.createHarness(renderer)
    harness.resize(manifest.viewport.cols, manifest.viewport.rows)
  }
  const server = SimulationServer.start(
    SimulationActions.createHarness(renderer),
    manifest.endpoints.ui,
    headless && manifest.recording ? () => SimulationRenderer.finish(renderer) : undefined,
  )
  process.stderr.write(`nikcli drive ui websocket: ${server.url}\n`)
  renderer.once("destroy", () => server.stop())
  return renderer
}

export * as Drive from "./simulation"
