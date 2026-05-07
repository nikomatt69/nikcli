import { type Tool } from "ai"
import z from "zod"
import { Config } from "../config/config"
import { Log } from "../util/log"
import { ConnectorAuth } from "./auth"
import { createTools, getHealthCheck, getPrompts } from "./registry"
import { resolveCredential, resolveCredentialType } from "./credentials"
import {
  getCachedStatus,
  getCachedTools,
  invalidateConnectorCache,
  invalidateToolsCache,
  invalidateStatusCache,
} from "./cache"
import { Effect } from "effect"
import { runPromiseWithLayer, withCurrentInstance } from "@/effect"

function runConnectorAuth<A, E>(effect: Effect.Effect<A, E, ConnectorAuth.Service>) {
  return runPromiseWithLayer(ConnectorAuth.defaultLayer, effect)
}

function connectorAuthGet(name: string) {
  return runConnectorAuth(
    Effect.gen(function* () {
      const auth = yield* ConnectorAuth.Service
      return yield* auth.get(name)
    }),
  )
}

function configGet() {
  return runPromiseWithLayer(
    Config.defaultLayer,
    withCurrentInstance(
      Effect.gen(function* () {
        const config = yield* Config.Service
        return yield* config.get()
      }),
    ),
  )
}

export namespace Connectors {
  const log = Log.create({ service: "connectors" })

  export const StatusSchema = z
    .discriminatedUnion("status", [
      z
        .object({
          status: z.literal("connected"),
        })
        .meta({ ref: "ConnectorStatusConnected" }),
      z
        .object({
          status: z.literal("disabled"),
        })
        .meta({ ref: "ConnectorStatusDisabled" }),
      z
        .object({
          status: z.literal("failed"),
          error: z.string(),
        })
        .meta({ ref: "ConnectorStatusFailed" }),
      z
        .object({
          status: z.literal("needs_auth"),
        })
        .meta({ ref: "ConnectorStatusNeedsAuth" }),
    ])
    .meta({ ref: "ConnectorStatus" })
  export type Status = z.infer<typeof StatusSchema>

  type ConnectorEntry = NonNullable<Config.Info["connectors"]>[string]
  export function isConnectorConfigured(entry: ConnectorEntry): entry is Config.Connector {
    return typeof entry === "object" && entry !== null && "type" in entry && typeof entry.type === "string"
  }

  function getRequiredCredentialType(type: string): "token" | "botToken" | "apiKey" | null {
    return resolveCredentialType(type)
  }

  async function checkConnector(name: string, config: Config.Connector): Promise<Status> {
    try {
      const credential = await resolveCredential(name, config)
      if (!credential) return { status: "needs_auth" }

      const healthCheck = getHealthCheck(config.type)
      if (!healthCheck) return { status: "failed", error: "Unknown connector type" }

      await healthCheck(credential)
      return { status: "connected" }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { status: "failed", error: message }
    }
  }

  async function resolveStatuses(): Promise<Record<string, Status>> {
    const cfg = await configGet()
    const config = cfg.connectors ?? {}
    const statuses: Record<string, Status> = {}

    await Promise.all(
      Object.entries(config).map(async ([key, connector]) => {
        if (!isConnectorConfigured(connector)) {
          log.error("Ignoring connector config entry without type", { key })
          return
        }

        if (connector.enabled === false) {
          statuses[key] = { status: "disabled" }
          return
        }

        const result = await checkConnector(key, connector).catch(() => undefined)
        if (!result) return

        statuses[key] = result
      }),
    )

    return statuses
  }

  export async function status(): Promise<Record<string, Status>> {
    const cfg = await configGet()
    const cacheKey = "connectors_status"

    return getCachedStatus(cacheKey, resolveStatuses, cfg)
  }

  export function invalidateStatus(): void {
    invalidateStatusCache()
  }

  export function invalidateTools(): void {
    invalidateToolsCache()
  }

  export function invalidateConnector(name: string): void {
    invalidateConnectorCache(name)
  }

  export async function hasStoredCredentials(name: string, type?: string): Promise<boolean> {
    const auth = await connectorAuthGet(name)
    if (!auth) return false
    if (!type) {
      return !!auth.token || !!auth.botToken || !!auth.apiKey
    }
    const requiredType = getRequiredCredentialType(type)
    if (!requiredType) return false
    switch (requiredType) {
      case "token":
        if (auth.token) return true
        if (type === "lovable") return !!auth.apiKey
        return false
      case "botToken":
        return !!auth.botToken
      case "apiKey":
        return !!auth.apiKey
    }
    return false
  }

  export async function tools(): Promise<Record<string, Tool>> {
    const cfg = await configGet()
    const cacheKey = "connectors_tools"

    const compute = async (): Promise<Record<string, Tool>> => {
      const config = cfg.connectors ?? {}
      const tools: Record<string, Tool> = {}

      await Promise.all(
        Object.entries(config).map(async ([name, connector]) => {
          if (!isConnectorConfigured(connector)) return
          if (connector.enabled === false) return

          try {
            const connectorTools = await createTools(name, connector)
            Object.assign(tools, connectorTools)
          } catch (error) {
            log.error("Failed to load connector tools", { name, connector: connector.type, error })
          }
        }),
      )

      return tools
    }

    return getCachedTools(cacheKey, compute, cfg)
  }

  type ConnectorPrompt = {
    name: string
    description: string
    type: string
    arguments?: Array<{ name: string; description: string }>
  }

  export async function prompts(): Promise<Record<string, ConnectorPrompt & { client: string }>> {
    const cfg = await configGet()
    const config = cfg.connectors ?? {}
    const connectorStatuses = await status()

    const prompts: Record<string, ConnectorPrompt & { client: string }> = {}

    for (const [connectorName, connector] of Object.entries(config)) {
      if (!isConnectorConfigured(connector)) continue
      if (connector.enabled === false) continue

      const connStatus = connectorStatuses[connectorName]
      if (connStatus?.status !== "connected") continue

      const operationPrompts = getPrompts(connector.type)

      for (const op of operationPrompts) {
        prompts[`${connectorName}_${op.name}`] = {
          name: `${connectorName}_${op.name}`,
          description: op.description,
          type: connector.type,
          arguments: op.args.map((arg) => ({ name: arg.name, description: arg.description })),
          client: connectorName,
        }
      }
    }

    return prompts
  }
}
