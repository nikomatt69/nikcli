import { BusEvent } from "../bus/bus-event"
import z from "zod/v4"

export const Connected = BusEvent.define(
  "mcp.server.connected",
  z.object({
    server: z.string(),
    type: z.enum(["remote", "local"]),
  }),
)

export const Disconnected = BusEvent.define(
  "mcp.server.disconnected",
  z.object({
    server: z.string(),
    reason: z.string(),
  }),
)

export const Reconnecting = BusEvent.define(
  "mcp.server.reconnecting",
  z.object({
    server: z.string(),
    attempt: z.number(),
    maxAttempts: z.number(),
    delay: z.number(),
  }),
)

export const HealthChanged = BusEvent.define(
  "mcp.server.health_changed",
  z.object({
    server: z.string(),
    healthy: z.boolean(),
    latencyMs: z.number().optional(),
    error: z.string().optional(),
  }),
)

export const ConnectionFailed = BusEvent.define(
  "mcp.server.connection_failed",
  z.object({
    server: z.string(),
    error: z.string(),
    attempt: z.number().optional(),
  }),
)
