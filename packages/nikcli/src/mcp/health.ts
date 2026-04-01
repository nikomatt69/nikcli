import type { Client } from "@modelcontextprotocol/sdk/client/index.js"

export interface ConnectionHealth {
  lastCheck: number
  latencyMs: number | null
  consecutiveFailures: number
  isHealthy: boolean
}

export interface ServerHealth {
  server: string
  healthy: boolean
  latencyMs: number | null
  lastCheck: number
  consecutiveFailures: number
}

export interface HealthCheckConfig {
  interval: number
  timeout: number
  unhealthyThreshold: number
}

export const DEFAULT_HEALTH_CHECK_CONFIG: HealthCheckConfig = {
  interval: 30_000,
  timeout: 10_000,
  unhealthyThreshold: 3,
}

const connectionHealth = new Map<string, ConnectionHealth>()
const healthCheckIntervals = new Map<string, NodeJS.Timeout>()
const healthCheckCleanups = new Map<string, () => void>()

export function initializeHealth(serverName: string): void {
  connectionHealth.set(serverName, {
    lastCheck: Date.now(),
    latencyMs: null,
    consecutiveFailures: 0,
    isHealthy: true,
  })
}

export function getHealth(serverName: string): ConnectionHealth | undefined {
  return connectionHealth.get(serverName)
}

export function updateHealth(
  serverName: string,
  success: boolean,
  latencyMs?: number,
  error?: string,
): { healthy: boolean; previousHealthy: boolean } {
  const health = connectionHealth.get(serverName)
  if (!health) {
    return { healthy: true, previousHealthy: true }
  }

  const previousHealthy = health.isHealthy

  if (success) {
    health.consecutiveFailures = 0
    health.isHealthy = true
    health.latencyMs = latencyMs ?? null
    health.lastCheck = Date.now()
  } else {
    health.consecutiveFailures++
    health.lastCheck = Date.now()

    if (health.consecutiveFailures >= DEFAULT_HEALTH_CHECK_CONFIG.unhealthyThreshold && health.isHealthy) {
      health.isHealthy = false
    }
  }

  return { healthy: health.isHealthy, previousHealthy }
}

export async function performHealthCheck(
  client: Client,
  serverName: string,
  timeout: number = DEFAULT_HEALTH_CHECK_CONFIG.timeout,
): Promise<{ success: boolean; latencyMs?: number; error?: string }> {
  const start = Date.now()
  try {
    await client.ping({ timeout })
    const latencyMs = Date.now() - start
    return { success: true, latencyMs }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export function startHealthChecks(
  serverName: string,
  client: Client,
  config: HealthCheckConfig = DEFAULT_HEALTH_CHECK_CONFIG,
  onHealthChanged?: (serverName: string, health: ServerHealth) => void,
): () => void {
  const interval = setInterval(async () => {
    const health = connectionHealth.get(serverName)
    if (!health) {
      clearInterval(interval)
      healthCheckIntervals.delete(serverName)
      return
    }

    const result = await performHealthCheck(client, serverName, config.timeout)
    const { healthy, previousHealthy } = updateHealth(serverName, result.success, result.latencyMs, result.error)
    if (onHealthChanged && healthy !== previousHealthy) {
      const current = connectionHealth.get(serverName)
      if (current) {
        onHealthChanged(serverName, {
          server: serverName,
          healthy: current.isHealthy,
          latencyMs: current.latencyMs,
          lastCheck: current.lastCheck,
          consecutiveFailures: current.consecutiveFailures,
        })
      }
    }
  }, config.interval)

  healthCheckIntervals.set(serverName, interval)

  const cleanup = () => {
    clearInterval(interval)
    healthCheckIntervals.delete(serverName)
    connectionHealth.delete(serverName)
    healthCheckCleanups.delete(serverName)
  }

  healthCheckCleanups.set(serverName, cleanup)
  return cleanup
}

export function stopHealthChecks(serverName: string): void {
  const cleanup = healthCheckCleanups.get(serverName)
  if (cleanup) {
    cleanup()
  }
}

export function stopAllHealthChecks(): void {
  for (const [serverName] of healthCheckIntervals) {
    stopHealthChecks(serverName)
  }
}

export function getAllHealth(): Record<string, ServerHealth> {
  const result: Record<string, ServerHealth> = {}
  for (const [server, health] of connectionHealth) {
    result[server] = {
      server,
      healthy: health.isHealthy,
      latencyMs: health.latencyMs,
      lastCheck: health.lastCheck,
      consecutiveFailures: health.consecutiveFailures,
    }
  }
  return result
}
