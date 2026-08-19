import { existsSync } from "node:fs"
import { socketPathFor } from "@nikcli-ai/browser-control"
import { hostBackend } from "@nikcli-ai/computer-use"
import { HerdrBridge } from "@nikcli-ai/util/herdr-bridge"
import { IslandBridge } from "@nikcli-ai/util/island-bridge"
import { Instance } from "@/project/instance"

function unavailable(reason: string) {
  return { available: false, reason }
}

export async function hostBrowser() {
  try {
    const socket = await socketPathFor(Instance.directory)
    if (!existsSync(socket)) {
      return unavailable("Browser control daemon is not running on the host")
    }
    const { BrowserControl } = await import("@/browser-control/browser-control")
    const sessions = (await BrowserControl.call("list")) as unknown[]
    return { available: true, sessions }
  } catch (error) {
    return unavailable(error instanceof Error ? error.message : String(error))
  }
}

export async function hostComputer() {
  try {
    const caps = await hostBackend.capabilities()
    return { available: true, ...caps }
  } catch (error) {
    return unavailable(error instanceof Error ? error.message : String(error))
  }
}

export async function hostHerdrGet() {
  try {
    const status = await HerdrBridge.status()
    return { available: true, ...status }
  } catch (error) {
    return unavailable(error instanceof Error ? error.message : String(error))
  }
}

export async function hostHerdrSet(input: { enabled: boolean }) {
  HerdrBridge.setEnabled(input.enabled)
  const status = await HerdrBridge.status()
  return { available: true, ...status }
}

export async function hostIsland() {
  try {
    const status = await IslandBridge.status()
    if (!status.supported) {
      return {
        available: false,
        reason: "nikcli Island is a macOS host companion",
        ...status,
      }
    }
    return { available: true, ...status }
  } catch (error) {
    return unavailable(error instanceof Error ? error.message : String(error))
  }
}

export async function hostDevtools() {
  const memory = process.memoryUsage()
  return {
    available: true,
    rss: memory.rss,
    heapUsed: memory.heapUsed,
    heapTotal: memory.heapTotal,
    external: memory.external,
    pid: process.pid,
    uptimeSec: Math.round(process.uptime()),
    platform: process.platform,
  }
}
