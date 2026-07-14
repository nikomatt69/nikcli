import { createCliRenderer, type CliRenderer, type CliRendererConfig } from "@opentui/core"
import { DriveManifest } from "../manifest"
import { SimulationActions } from "./actions"
import { SimulationRenderer } from "./renderer"
import { SimulationServer } from "./server"

/** Create the visible or headless renderer and expose its deterministic drive API. */
export async function create(options: CliRendererConfig): Promise<CliRenderer> {
  const headless = process.env.NIKCLI_DRIVE_RENDERER === "headless"
  const manifest = DriveManifest.resolve()
  const renderer = headless
    ? await SimulationRenderer.create(options, manifest.recording?.timeline, manifest.viewport)
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
