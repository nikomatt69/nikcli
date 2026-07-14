import { DriveManifest } from "../manifest"
import { SimulationControl } from "./control"
import { SimulationNetwork, type Options } from "./network"

export interface Backend {
  readonly openai: string
  readonly control: string
  readonly stop: () => void
}

/** Start the loopback OpenAI mock and the driver control WebSocket. */
export async function start(
  options: Partial<Omit<Options, "endpoint">> & { readonly endpoint?: string } = {},
): Promise<Backend> {
  const manifest = DriveManifest.resolve()
  const network = await SimulationNetwork.start({
    ...SimulationNetwork.optionsFromEnv(options.endpoint ?? manifest.endpoints.openai),
    ...options,
    endpoint: options.endpoint ?? manifest.endpoints.openai,
  })
  const control = SimulationControl.start(manifest.endpoints.backend, network)
  process.stderr.write(`nikcli simulation OpenAI: ${network.url} (${network.mode})\n`)
  process.stderr.write(`nikcli drive backend websocket: ${control.url}\n`)
  return {
    openai: network.url,
    control: control.url,
    stop: () => {
      control.stop()
      network.stop()
    },
  }
}

export { SimulationControl } from "./control"
export { SimulationLLMExchange } from "./llm-exchange"
export { SimulationNetwork } from "./network"
export { SimulationOpenAI } from "./openai"
export type { Mode, Options } from "./network"

export * as SimulationBackend from "./index"
