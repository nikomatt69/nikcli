import { Tool } from "./tool"
import { Config } from "../config/config"
import { executeOperation } from "../connectors/registry"
import { listConnectorTypes, getConnectorSpec } from "../connectors/registry"
import { invalidateConnectorCache } from "../connectors/cache"
import z from "zod"

const allOperations = listConnectorTypes().flatMap((type) => {
  const spec = getConnectorSpec(type)
  return spec?.operations.map((op) => op.name) ?? []
})

export const UseConnectorTool = Tool.define("use_connector", async () => {
  return {
    description: "Execute operations on external services (Figma, Slack, GitHub, Lovable)",
    parameters: z.object({
      connector: z.string().describe("Connector name"),
      operation: z.enum(allOperations as [string, ...string[]]).describe("Operation to perform"),
      args: z.record(z.string(), z.any()).describe("Operation arguments"),
    }),
    async execute({ connector, operation, args }) {
      const config = await Config.get()
      const connectorConfig = config.connectors?.[connector]

      if (!connectorConfig || typeof connectorConfig !== "object" || !("type" in connectorConfig)) {
        throw new Error(`Connector "${connector}" not found`)
      }

      try {
        const result = await executeOperation(connector, connectorConfig, operation, args)

        return {
          title: `${connector} ${operation}`,
          metadata: {},
          output: typeof result === "string" ? result : JSON.stringify(result, null, 2),
        }
      } catch (error) {
        invalidateConnectorCache(connector)

        if (error instanceof Error) {
          throw new Error(`${connector} ${operation} failed: ${error.message}`)
        }
        throw new Error(`${connector} ${operation} failed: ${String(error)}`)
      }
    },
  }
})
