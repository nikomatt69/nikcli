import { existsSync } from "node:fs"
import z from "zod"
import { socketPathFor } from "@nikcli-ai/browser-control"
import { hostBackend } from "@nikcli-ai/computer-use"
import { HerdrBridge } from "@nikcli-ai/util/herdr-bridge"
import { IslandBridge } from "@nikcli-ai/util/island-bridge"
import { Instance } from "@/project/instance"
import { body, isResponse, json } from "./request"

function unavailable(reason: string) {
  return json({ available: false, reason })
}

export async function handleHostStatusRequest(request: Request): Promise<Response | undefined> {
  const path = new URL(request.url).pathname
  if (!path.startsWith("/mobile/host/")) return

  if (path === "/mobile/host/browser" && request.method === "GET") {
    try {
      const socket = await socketPathFor(Instance.directory)
      if (!existsSync(socket)) {
        return unavailable("Browser control daemon is not running on the host")
      }
      const { BrowserControl } = await import("@/browser-control/browser-control")
      const sessions = await BrowserControl.call("list")
      return json({ available: true, sessions })
    } catch (error) {
      return unavailable(error instanceof Error ? error.message : String(error))
    }
  }

  if (path === "/mobile/host/computer" && request.method === "GET") {
    try {
      const caps = await hostBackend.capabilities()
      return json({ available: true, ...caps })
    } catch (error) {
      return unavailable(error instanceof Error ? error.message : String(error))
    }
  }

  if (path === "/mobile/host/herdr" && request.method === "GET") {
    try {
      const status = await HerdrBridge.status()
      return json({ available: true, ...status })
    } catch (error) {
      return unavailable(error instanceof Error ? error.message : String(error))
    }
  }
  if (path === "/mobile/host/herdr" && request.method === "POST") {
    const input = await body(request, z.object({ enabled: z.boolean() }))
    if (isResponse(input)) return input
    HerdrBridge.setEnabled(input.enabled)
    const status = await HerdrBridge.status()
    return json({ available: true, ...status })
  }

  if (path === "/mobile/host/island" && request.method === "GET") {
    try {
      const status = await IslandBridge.status()
      if (!status.supported) {
        return json({
          available: false,
          reason: "nikcli Island is a macOS host companion",
          ...status,
        })
      }
      return json({ available: true, ...status })
    } catch (error) {
      return unavailable(error instanceof Error ? error.message : String(error))
    }
  }

  if (path === "/mobile/host/devtools" && request.method === "GET") {
    const memory = process.memoryUsage()
    return json({
      available: true,
      rss: memory.rss,
      heapUsed: memory.heapUsed,
      heapTotal: memory.heapTotal,
      external: memory.external,
      pid: process.pid,
      uptimeSec: Math.round(process.uptime()),
      platform: process.platform,
    })
  }
}
