import type { Argv, InferredOptionTypes } from "yargs"
import { Config } from "../config/config"
import { runPromiseWithLayer } from "@/effect"
import { Effect } from "effect"

const options = {
  port: {
    type: "number" as const,
    describe: "port to listen on",
    default: 0,
  },
  hostname: {
    type: "string" as const,
    describe: "hostname to listen on",
    default: "127.0.0.1",
  },
  mdns: {
    type: "boolean" as const,
    describe: "enable mDNS service discovery (defaults hostname to 0.0.0.0)",
    default: false,
  },
  cors: {
    type: "string" as const,
    array: true,
    describe: "additional domains to allow for CORS",
    default: [] as string[],
  },
}

export type NetworkOptions = InferredOptionTypes<typeof options>

export function withNetworkOptions<T>(yargs: Argv<T>) {
  return yargs.options(options)
}

function runConfig<A, E>(effect: Effect.Effect<A, E, Config.Service>) {
  return runPromiseWithLayer(Config.defaultLayer, effect)
}

export async function resolveNetworkOptions(args: NetworkOptions) {
  const config = await runConfig(
    Effect.gen(function* () {
      const service = yield* Config.Service
      return yield* service.getGlobal()
    }),
  )
  const portExplicitlySet = process.argv.includes("--port")
  const hostnameExplicitlySet = process.argv.includes("--hostname")
  const mdnsExplicitlySet = process.argv.includes("--mdns")
  const corsExplicitlySet = process.argv.includes("--cors")
  const envPortValue = Number.parseInt(process.env.PORT || "", 10)
  const envPort = Number.isInteger(envPortValue) && envPortValue > 0 ? envPortValue : undefined

  const mdns = mdnsExplicitlySet ? args.mdns : (config?.server?.mdns ?? args.mdns)
  const port = portExplicitlySet ? args.port : (config?.server?.port ?? envPort ?? args.port)
  const hostname = hostnameExplicitlySet
    ? args.hostname
    : mdns && !config?.server?.hostname
      ? "0.0.0.0"
      : (config?.server?.hostname ?? args.hostname)
  const configCors = config?.server?.cors ?? []
  const argsCors = Array.isArray(args.cors) ? args.cors : args.cors ? [args.cors] : []
  const cors = [...configCors, ...argsCors]

  return { hostname, port, mdns, cors }
}
