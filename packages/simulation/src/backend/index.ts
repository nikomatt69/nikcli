import { DriveManifest } from "../manifest"
import { SimulationControl } from "./control"
import { SimulationNetwork, type Options } from "./network"

export interface Backend {
  readonly openai: string
  readonly control: string
  readonly stop: () => void
}

/** Environment overrides for the nikcli worker that route its default model into this backend. */
export function workerEnv(openai: string, inlineConfig = process.env.NIKCLI_CONFIG_CONTENT): Record<string, string> {
  const inherited: unknown = inlineConfig ? JSON.parse(inlineConfig) : {}
  if (typeof inherited !== "object" || inherited === null || Array.isArray(inherited)) {
    throw new Error("NIKCLI_CONFIG_CONTENT must be a JSON object in simulation mode")
  }
  const current = inherited as Record<string, unknown>
  const providers =
    typeof current.provider === "object" && current.provider !== null && !Array.isArray(current.provider)
      ? (current.provider as Record<string, unknown>)
      : {}
  const baseURL = `${openai.replace(/\/+$/, "")}/v1`
  const config = {
    ...current,
    model: "simulation/deterministic",
    provider: {
      ...providers,
      simulation: {
        name: "Nikcli deterministic simulation",
        api: baseURL,
        npm: "@ai-sdk/openai-compatible",
        options: { apiKey: "simulation", baseURL, includeUsage: false },
        models: {
          deterministic: {
            id: "deterministic",
            name: "Deterministic simulation",
            release_date: "2026-07-14",
            limit: { context: 128_000, output: 16_384 },
            cost: { input: 0, output: 0 },
          },
        },
      },
    },
  }
  return {
    NIKCLI_CONFIG_CONTENT: JSON.stringify(config),
    NIKCLI_DISABLE_MODELS_FETCH: "1",
    NIKCLI_DISABLE_AUTOUPDATE: "1",
  }
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
export { workerEnv as simulationWorkerEnv }
export type { Mode, Options } from "./network"

export * as SimulationBackend from "./index"
