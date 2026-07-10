import type { Argv } from "yargs"
import { Config } from "../config/config"
import { runPromiseWithLayer } from "@/effect"
import { Effect } from "effect"
import { Log } from "@/util/log"
import z from "zod"

const log = Log.create({ service: "network" })

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

export type NetworkOptions = {
  port?: number
  hostname?: string
  mdns?: boolean
  cors?: string | string[]
}

const NetworkOptionsSchema = z.object({
  port: z.number().int().min(0).max(65535).optional(),
  hostname: z.string().optional(),
  mdns: z.boolean().optional(),
  cors: z.array(z.string()).optional(),
})

export function withNetworkOptions<T extends object>(yargs: Argv<T>): Argv<T & NetworkOptions> {
  return yargs.options(options) as Argv<T & NetworkOptions>
}

function runConfig<A, E>(effect: Effect.Effect<A, E, Config.Service>): Promise<A> {
  return runPromiseWithLayer(Config.defaultLayer, effect)
}

export interface ResolvedNetworkConfig {
  hostname: string
  port: number
  mdns: boolean
  cors: string[]
}

/** True when the bind address is loopback-only (not LAN-visible). */
export function isLoopbackHostname(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "::1" || hostname === "localhost"
}

/**
 * Whether the TUI (or similar) should start an HTTP server at boot from resolved network options.
 * Config-driven LAN/mDNS (non-loopback hostname, fixed port, mdns) still starts the server.
 */
export function shouldStartHttpServer(opts: ResolvedNetworkConfig): boolean {
  return opts.port !== 0 || opts.mdns || !isLoopbackHostname(opts.hostname)
}

export async function resolveNetworkOptions(args: Partial<NetworkOptions>): Promise<ResolvedNetworkConfig> {
  log.debug("Resolving network options", { args })

  const parsedArgs = NetworkOptionsSchema.safeParse(args)
  if (!parsedArgs.success) {
    log.warn("Invalid network options provided, using defaults", {
      errors: parsedArgs.error.issues,
    })
  }

  const validArgs = parsedArgs.success ? parsedArgs.data : args

  const config = await runConfig(
    Effect.gen(function* () {
      const service = yield* Config.Service
      return yield* service.getGlobal()
    }),
  ).catch((error) => {
    log.warn("Failed to load config, using defaults", { error })
    return null
  })

  const portExplicitlySet = process.argv.includes("--port")
  const hostnameExplicitlySet = process.argv.includes("--hostname")
  const mdnsExplicitlySet = process.argv.includes("--mdns")
  const managedTerminal = process.env.NIKCLI_TERMINAL === "1"

  const envPortValue = Number.parseInt(process.env.PORT || "", 10)
  const envPort = Number.isInteger(envPortValue) && envPortValue > 0 ? envPortValue : undefined

  const mdns = mdnsExplicitlySet
    ? (validArgs.mdns ?? false)
    : managedTerminal
      ? (validArgs.mdns ?? false)
      : (config?.server?.mdns ?? validArgs.mdns ?? false)

  const port = portExplicitlySet
    ? (validArgs.port ?? 0)
    : managedTerminal
      ? (validArgs.port ?? 0)
      : (config?.server?.port ?? envPort ?? validArgs.port ?? 0)

  const hostname = hostnameExplicitlySet
    ? (validArgs.hostname ?? "127.0.0.1")
    : managedTerminal
      ? (validArgs.hostname ?? "127.0.0.1")
      : mdns && !config?.server?.hostname
        ? "0.0.0.0"
        : (config?.server?.hostname ?? validArgs.hostname ?? "127.0.0.1")

  const configCors = config?.server?.cors ?? []
  const argsCors = Array.isArray(validArgs.cors) ? validArgs.cors : validArgs.cors ? [validArgs.cors] : []
  const cors = [...configCors, ...argsCors]

  const result: ResolvedNetworkConfig = {
    hostname,
    port,
    mdns,
    cors,
  }

  log.debug("Network options resolved", { result })
  return result
}
