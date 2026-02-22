/// <reference path="./localtunnel.d.ts" />

import { spawn, type ChildProcess } from "node:child_process"
import type { TunnelProvider } from "./types"

export type { TunnelProvider }

export interface TunnelResult {
  url: string
  provider: TunnelProvider
  close: () => Promise<void>
}

export async function createTunnel(port: number, provider: TunnelProvider = "cloudflared"): Promise<TunnelResult> {
  const manager = new TunnelManager(provider)
  const url = await manager.create(port)
  return {
    url,
    provider,
    close: () => manager.close(),
  }
}

export class TunnelManager {
  private provider: TunnelProvider
  private process: ChildProcess | null = null
  private url: string | null = null
  private tunnelInstance: any = null

  constructor(provider: TunnelProvider) {
    this.provider = provider

    const cleanup = () => {
      if (this.process && !this.process.killed) {
        this.process.kill("SIGKILL")
      }
    }

    process.on("exit", cleanup)
    process.on("SIGINT", () => {
      cleanup()
      process.exit(0)
    })
    process.on("SIGTERM", () => {
      cleanup()
      process.exit(0)
    })
  }

  async create(port: number): Promise<string> {
    switch (this.provider) {
      case "localtunnel":
        return this.createLocaltunnel(port)
      case "cloudflared":
        return this.createCloudflared(port)
      case "ngrok":
        return this.createNgrok(port)
      case "remotosh":
        return this.createRemotosh(port)
      default:
        throw new Error(`Unknown tunnel provider: ${this.provider}`)
    }
  }

  async close(): Promise<void> {
    if (this.tunnelInstance?.close) {
      this.tunnelInstance.close()
      this.tunnelInstance = null
    }
    if (this.process) {
      this.process.kill()
      this.process = null
    }
    this.url = null
  }

  getUrl(): string | null {
    return this.url
  }

  private async createLocaltunnel(port: number): Promise<string> {
    try {
      const localtunnel = await import("localtunnel")
      const tunnel = await localtunnel.default({ port })
      this.tunnelInstance = tunnel
      this.url = tunnel.url
      tunnel.on("close", () => {
        this.url = null
      })
      return tunnel.url
    } catch {
      return this.createLocaltunnelCli(port)
    }
  }

  private createLocaltunnelCli(port: number): Promise<string> {
    return new Promise((resolve, reject) => {
      this.process = spawn("npx", ["localtunnel", "--port", port.toString(), "--print-requests", "false"], {
        stdio: ["pipe", "pipe", "pipe"],
        shell: false,
      })

      let output = ""
      const timeout = setTimeout(() => {
        reject(new Error("Localtunnel timeout"))
      }, 30000)

      this.process.stdout?.on("data", (data: Buffer) => {
        output += data.toString()
        const match = output.match(/your url is:\s*(https?:\/\/[^\s]+)/i)
        if (match?.[1]) {
          clearTimeout(timeout)
          this.url = match[1]
          resolve(match[1])
        }
      })

      this.process.stderr?.on("data", () => {})
      this.process.on("error", (error) => {
        clearTimeout(timeout)
        reject(error)
      })
      this.process.on("exit", (code) => {
        if (code !== 0 && !this.url) {
          clearTimeout(timeout)
          reject(new Error(`Localtunnel exited with code ${code}`))
        }
      })
    })
  }

  private createCloudflared(port: number): Promise<string> {
    return new Promise((resolve, reject) => {
      this.process = spawn("cloudflared", ["tunnel", "--url", `http://localhost:${port}`, "--metrics", "localhost:0"], {
        stdio: ["pipe", "pipe", "pipe"],
      })

      let output = ""
      const timeout = setTimeout(() => {
        reject(new Error("Cloudflared timeout"))
      }, 30000)

      const handleData = (data: Buffer) => {
        output += data.toString()
        const match = output.match(/(https:\/\/[^\s]+\.trycloudflare\.com)/i)
        if (match?.[1]) {
          clearTimeout(timeout)
          this.url = match[1]
          resolve(match[1])
        }
      }

      this.process.stdout?.on("data", handleData)
      this.process.stderr?.on("data", handleData)
      this.process.on("error", (error) => {
        clearTimeout(timeout)
        reject(error)
      })
      this.process.on("exit", (code) => {
        if (code !== 0 && !this.url) {
          clearTimeout(timeout)
          reject(new Error(`Cloudflared exited with code ${code}`))
        }
      })
    })
  }

  private createNgrok(port: number): Promise<string> {
    return new Promise((resolve, reject) => {
      this.process = spawn("ngrok", ["http", port.toString(), "--log=stdout", "--log-level=info"], {
        stdio: ["pipe", "pipe", "pipe"],
      })

      let output = ""
      const timeout = setTimeout(() => {
        reject(new Error("Ngrok timeout"))
      }, 30000)

      this.process.stdout?.on("data", (data: Buffer) => {
        output += data.toString()
        const match = output.match(/url=(https?:\/\/[^\s]+)/i)
        if (match?.[1]) {
          clearTimeout(timeout)
          this.url = match[1]
          resolve(match[1])
        }
      })

      this.process.stderr?.on("data", () => {})
      this.process.on("error", (error) => {
        clearTimeout(timeout)
        reject(error)
      })
      this.process.on("exit", (code) => {
        if (code !== 0 && !this.url) {
          clearTimeout(timeout)
          reject(new Error(`Ngrok exited with code ${code}`))
        }
      })
    })
  }

  /**
   * Creates a Remotosh tunnel.
   *
   * Remotosh is a terminal sharing service that runs as a separate process.
   * This method spawns the remotosh CLI and captures the tunnel URL from stdout/stderr.
   *
   * Environment Variables:
   * - REMOTOSH_CMD: Command to run (default: "remoto")
   * - REMOTOSH_ARGS: Additional arguments (space-separated).
   *   Do NOT use {port} placeholder as remotosh doesn't support port forwarding.
   *   Example: "session my-session-name"
   *
   * @param port - Ignored by default (remotosh manages its own port)
   * @returns Promise resolving to the tunnel URL
   * @throws Error if timeout (60s) or process exits with error
   */
  private createRemotosh(port: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const cmd = process.env.REMOTOSH_CMD || "remoto"
      const args =
        process.env.REMOTOSH_ARGS?.split(" ")
          .map((arg) => arg.trim())
          .filter((arg) => Boolean(arg) && !arg.includes("{port}")) ?? []

      this.process = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"], shell: false })

      if (process.env.NODE_DEBUG?.includes("nikcli:remotosh")) {
        process.stderr.write(`[nikcli:remotosh] Spawning: ${cmd} ${args.join(" ")}\n`)
      }

      let output = ""
      const timeout = setTimeout(() => {
        reject(new Error("Remotosh timeout"))
      }, 60000)

      const handleData = (data: Buffer) => {
        const text = data.toString()
        if (process.env.NODE_DEBUG?.includes("nikcli:remotosh")) {
          process.stderr.write(`[nikcli:remotosh] ${text}`)
        }
        output += text
        const match = output.match(/(?:visit|connect)?\s*(https?:\/\/[^\s]+)/i)
        if (match?.[1]) {
          if (process.env.NODE_DEBUG?.includes("nikcli:remotosh")) {
            process.stderr.write(`[nikcli:remotosh] Matched URL: ${match[1]}\n`)
          }
          clearTimeout(timeout)
          this.url = match[1]
          resolve(match[1])
        }
      }

      this.process.stdout?.on("data", handleData)
      this.process.stderr?.on("data", handleData)
      this.process.on("error", (error) => {
        clearTimeout(timeout)
        reject(error)
      })
      this.process.on("exit", (code) => {
        if (code !== 0 && !this.url) {
          clearTimeout(timeout)
          reject(new Error(`Remotosh exited with code ${code}`))
        }
      })
    })
  }
}

export async function checkTunnelAvailability(provider: TunnelProvider): Promise<boolean> {
  try {
    const { execSync } = await import("node:child_process")

    switch (provider) {
      case "localtunnel":
        try {
          await import("localtunnel")
          return true
        } catch {
          execSync("npx localtunnel --version", { stdio: "pipe" })
          return true
        }
      case "cloudflared":
        execSync("cloudflared --version", { stdio: "pipe" })
        return true
      case "ngrok":
        execSync("ngrok version", { stdio: "pipe" })
        return true
      case "remotosh":
        try {
          execSync("remoto --version", { stdio: "pipe" })
          return true
        } catch {
          return false
        }
      default:
        return false
    }
  } catch {
    return false
  }
}

export async function findAvailableTunnel(): Promise<TunnelProvider | null> {
  const providers: TunnelProvider[] = ["localtunnel", "cloudflared", "ngrok", "remotosh"]
  for (const provider of providers) {
    if (await checkTunnelAvailability(provider)) {
      return provider
    }
  }
  return null
}

export async function probeTunnel(url: string, timeoutMs = 8000): Promise<boolean> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  return fetch(url, { signal: controller.signal })
    .then((res) => res.ok)
    .catch(() => false)
    .finally(() => clearTimeout(timeout))
}
