import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { withInstanceAsync } from "@/effect"
import { UI } from "../ui"
import { remoteService, qrRenderer, type RemoteSession, type SessionOptions } from "@nikcli-ai/util/remote-tunnel"
import { createTunnel, checkTunnelAvailability, probeTunnel, type TunnelProvider } from "@nikcli-ai/remote"
import { withNetworkOptions } from "../network"
import { startMobileHost, stopMobileHost, type MobileHostRuntime } from "./mobile"
import readline from "node:readline"
import clipboardy from "clipboardy"
import os from "node:os"

const RemoteStartCommand = cmd({
  command: "start",
  describe: "start a new remote control session",
  builder: (yargs: Argv) =>
    withNetworkOptions(yargs)
      .default("hostname", "0.0.0.0")
      .option("name", {
        alias: ["n"],
        type: "string",
        describe: "terminal remote session name",
      })
      .option("timeout", {
        alias: ["t"],
        type: "string",
        describe: "connection timeout in seconds",
        default: "15",
      })
      .option("no-tunnel", {
        describe: "disable public tunnel (use local network only)",
        type: "boolean",
        default: false,
      })
      .option("provider", {
        describe: "tunnel provider (localtunnel, cloudflared, ngrok, remotosh)",
        type: "string",
      })
      .option("cloud", {
        describe: "enable cloud relay mode",
        type: "boolean",
        default: false,
      })
      .option("cloud-url", {
        describe: "cloud relay base URL",
        type: "string",
      })
      .option("cloud-token", {
        describe: "cloud relay bearer token",
        type: "string",
      })
      .option("cloud-device-id", {
        describe: "cloud relay device identifier",
        type: "string",
      })
      .option("cloud-session-id", {
        describe: "override cloud relay session ID",
        type: "string",
      })
      .option("cloud-public-key", {
        describe: "optional E2E public key to register with cloud",
        type: "string",
      })
      .option("mobile", {
        describe: "also start the /mobile API host and print an app pairing QR",
        type: "boolean",
        default: false,
      })
      .option("mobile-only", {
        describe: "start only the mobile-compatible /mobile API host",
        type: "boolean",
        default: false,
      })
      .option("public-url", {
        describe: "public HTTPS URL used by the mobile app outside your LAN or tailnet",
        type: "string",
      })
      .option("pair", {
        describe: "create and print a mobile pairing token when the mobile host is enabled",
        type: "boolean",
        default: true,
      })
      .option("pair-name", {
        describe: "name for the generated mobile pairing token",
        type: "string",
        default: "iphone",
      })
      .option("pair-expiry-days", {
        describe: "optional mobile pairing token expiry in days",
        type: "number",
      }),
  handler: async (args) => {
    await withInstanceAsync({ directory: process.cwd() }, async () => {
      let mobileHost: MobileHostRuntime | undefined
      let terminalStarted = false
      const mobileEnabled = Boolean(args.mobile || args.mobileOnly)
      const terminalEnabled = !args.mobileOnly

      try {
        if (!terminalEnabled && !mobileEnabled) {
          UI.println("No remote mode selected")
          return
        }

        if (terminalEnabled) {
          await ensureRemoteService()

          if (remoteService.hasActiveSession()) {
            UI.println("A remote session is already active")
            UI.println('Use "nikcli remote status" for details or "nikcli remote stop" to end it.')
            return
          }
        }

        let session: RemoteSession | undefined
        let cloud: SessionOptions["cloud"] | undefined

        if (terminalEnabled) {
          cloud = resolveCloudOptions(args)
          session = await remoteService.startSession({
            name: args.name as string | undefined,
            timeout: parseInt(args.timeout as string, 10) * 1000,
            ...(cloud ? { cloud } : undefined),
          })
          terminalStarted = true

          await maybeCreateTunnel(session, {
            enableTunnel: !args.noTunnel,
            provider: args.provider as TunnelProvider | undefined,
          })

          if (cloud?.enabled) {
            UI.println(`Cloud relay enabled: ${cloud.url}`)
          }

          await qrRenderer.render(session)
        }

        if (mobileEnabled) {
          mobileHost = await startMobileHost({
            ...args,
            publicUrl: args.publicUrl as string | undefined,
            pair: Boolean(args.pair),
            pairName: String(args.pairName || "iphone"),
            pairExpiryDays: args.pairExpiryDays ? Number(args.pairExpiryDays) : undefined,
            directory: process.cwd(),
          })
        }

        if (session) {
          try {
            await setupKeyboardControl(session)
          } finally {
            await stopMobileHost(mobileHost)
          }
          return
        }

        if (mobileHost) {
          UI.println("Mobile remote host is running. Press Ctrl+C to stop.")
          await keepMobileHostAlive(mobileHost)
        }
      } catch (error: any) {
        await stopMobileHost(mobileHost).catch(() => undefined)
        if (terminalStarted && remoteService.hasActiveSession()) {
          await remoteService.stopSession().catch(() => undefined)
        }
        UI.error(`Failed to start remote control: ${error?.message ?? error}`)
      }
    })
  },
})

const RemoteStopCommand = cmd({
  command: "stop",
  describe: "stop the active remote session",
  handler: async () => {
    await withInstanceAsync({ directory: process.cwd() }, async () => {
      try {
        await ensureRemoteService()
        if (!remoteService.hasActiveSession()) {
          UI.println("No active remote session")
          return
        }

        await remoteService.stopSession()
        UI.println("Remote session stopped")
      } catch (error: any) {
        UI.error(`Failed to stop session: ${error?.message ?? error}`)
      }
    })
  },
})

const RemoteStatusCommand = cmd({
  command: "status",
  describe: "show remote session status",
  builder: (yargs: Argv) =>
    yargs.option("json", {
      describe: "output as JSON",
      type: "boolean",
    }),
  handler: async (args) => {
    await withInstanceAsync({ directory: process.cwd() }, async () => {
      {
        await ensureRemoteService()
        const session = remoteService.getSession()

        if (!session || session.status === "stopped") {
          if (args.json) {
            process.stdout.write(JSON.stringify({ active: false }))
          } else {
            UI.println("No active remote session")
            UI.println('Use "nikcli remote start" to create one.')
          }
          return
        }

        if (args.json) {
          process.stdout.write(
            JSON.stringify(
              {
                active: true,
                id: session.id,
                name: session.name,
                status: session.status,
                qrUrl: session.qrUrl,
                connectedDevices: session.connectedDevices.length,
                startedAt: session.startedAt.toISOString(),
                lastActivity: session.lastActivity.toISOString(),
              },
              null,
              2,
            ),
          )
          return
        }

        await qrRenderer.render(session)
      }
    })
  },
})

const RemoteShareCommand = cmd({
  command: "share",
  describe: "get shareable session link",
  handler: async () => {
    await withInstanceAsync({ directory: process.cwd() }, async () => {
      {
        await ensureRemoteService()
        await shareSession()
      }
    })
  },
})

const RemoteAttachCommand = cmd({
  command: "attach <sessionId>",
  describe: "attach to an existing session",
  handler: async (args) => {
    await withInstanceAsync({ directory: process.cwd() }, async () => {
      {
        await ensureRemoteService()
        UI.println(`Attaching to session ${args.sessionId}...`)
        UI.println("This feature is not yet implemented.")
      }
    })
  },
})

export const RemoteCommand = cmd({
  command: "remote [command]",
  describe: "manage terminal and mobile app remote control sessions",
  builder: (yargs) =>
    yargs
      .command(RemoteStartCommand)
      .command(RemoteStopCommand)
      .command(RemoteStatusCommand)
      .command(RemoteShareCommand)
      .command(RemoteAttachCommand),
  async handler() {
    showRemoteHelp()
  },
})

function showRemoteHelp(): void {
  UI.println("NikCLI Remote - Terminal and Mobile App Control")
  UI.println("")
  UI.println("Commands:")
  UI.println("  start [--name <name>]         Start a terminal remote session")
  UI.println("      --mobile                  Also start /mobile API host and pairing QR")
  UI.println("      --mobile-only             Start only the mobile-compatible API host")
  UI.println("      --public-url <url>        Mobile public HTTPS URL")
  UI.println("      --pair-name <name>        Mobile pairing token label")
  UI.println("      --cloud                   Enable terminal cloud relay mode")
  UI.println("      --cloud-url <url>         Terminal cloud relay URL")
  UI.println("      --cloud-token <t>         Terminal cloud relay token")
  UI.println("  stop                          Stop the active terminal remote session")
  UI.println("  status [--json]               Show terminal session status and QR code")
  UI.println("  share                         Get terminal shareable session link")
  UI.println("  attach <id>                   Attach to an existing terminal session")
}

function resolveCloudOptions(args: Record<string, unknown>): SessionOptions["cloud"] | undefined {
  const enabled = Boolean(args.cloud)
  if (!enabled) return undefined

  const cloudUrl = String(args.cloudUrl || args["cloud-url"] || process.env.NIKCLI_CLOUD_URL || "").trim()
  const cloudToken = String(args.cloudToken || args["cloud-token"] || process.env.NIKCLI_CLOUD_TOKEN || "").trim()
  const cloudDeviceID = String(
    args.cloudDeviceId || args["cloud-device-id"] || process.env.NIKCLI_CLOUD_DEVICE_ID || `nikcli-${os.hostname()}`,
  ).trim()
  const cloudSessionID = String(
    args.cloudSessionId || args["cloud-session-id"] || process.env.NIKCLI_CLOUD_SESSION_ID || "",
  ).trim()
  const cloudPublicKey = String(
    args.cloudPublicKey || args["cloud-public-key"] || process.env.NIKCLI_CLOUD_PUBLIC_KEY || "",
  ).trim()

  if (!cloudUrl) {
    throw new Error("Cloud relay requires --cloud-url or NIKCLI_CLOUD_URL")
  }
  if (!cloudToken) {
    throw new Error("Cloud relay requires --cloud-token or NIKCLI_CLOUD_TOKEN")
  }
  if (!cloudDeviceID) {
    throw new Error("Cloud relay requires --cloud-device-id or NIKCLI_CLOUD_DEVICE_ID")
  }

  return {
    enabled: true,
    url: cloudUrl,
    token: cloudToken,
    deviceID: cloudDeviceID,
    ...(cloudSessionID ? { sessionID: cloudSessionID } : undefined),
    ...(cloudPublicKey ? { publicKey: cloudPublicKey } : undefined),
  }
}

async function maybeCreateTunnel(
  session: RemoteSession,
  options: { enableTunnel: boolean; provider?: TunnelProvider },
): Promise<void> {
  if (!options.enableTunnel) return
  if (options.provider === "none") return
  const port = session.port ?? remoteService.getServerPort()
  if (!port) return

  const providers: TunnelProvider[] = []
  if (options.provider) {
    providers.push(options.provider)
  }
  if (!options.provider) {
    const candidates: TunnelProvider[] = ["localtunnel", "cloudflared", "ngrok", "remotosh"]
    for (const candidate of candidates) {
      if (await checkTunnelAvailability(candidate)) {
        providers.push(candidate)
      }
    }
  }

  if (providers.length === 0) {
    UI.println("No tunnel providers available; using local network only")
    return
  }

  for (const provider of providers) {
    const result = await createTunnel(port, provider).catch((error) => {
      const message = error instanceof Error ? error.message : String(error)
      UI.println(`Tunnel failed (${provider}): ${message}`)
      return null
    })

    if (!result) continue

    const url = new URL(result.url)
    url.searchParams.set("s", session.id)
    url.searchParams.set("t", remoteService.getSessionSecret())
    const tunnelUrl = url.toString()

    const ok = await probeTunnel(tunnelUrl)
    if (!ok) {
      await result.close().catch(() => {})
      UI.println(`Tunnel unreachable (${provider}); trying next provider`)
      continue
    }

    session.tunnelUrl = tunnelUrl
    session.qrUrl = tunnelUrl
    return
  }

  UI.println("Tunnel failed: no reachable providers")
}

async function setupKeyboardControl(session: RemoteSession): Promise<void> {
  if (!process.stdin.isTTY) return

  readline.emitKeypressEvents(process.stdin)
  if (typeof process.stdin.setRawMode === "function") {
    process.stdin.setRawMode(true)
  }
  process.stdin.resume()

  UI.println("Press [q] to stop, [r] to refresh, [s] to share")

  const handleKeypress = async (_str: string, key: readline.Key) => {
    if (!key) return

    switch (key.name) {
      case "q":
      case "escape":
        await stopSessionAndCleanup(handleKeypress)
        break
      case "r":
        if (session) {
          await qrRenderer.render(session)
          UI.println("Press [q] to stop, [r] to refresh, [s] to share")
        }
        break
      case "s":
        await shareSession()
        break
      case "c":
        if (key.ctrl) {
          await stopSessionAndCleanup(handleKeypress)
        }
        break
    }
  }

  process.stdin.on("keypress", handleKeypress)

  const onDeviceConnected = (sess: RemoteSession) => {
    qrRenderer.updateStatus(sess)
  }
  const onDeviceDisconnected = (sess: RemoteSession) => {
    qrRenderer.updateStatus(sess)
  }

  remoteService.on("device:connected", onDeviceConnected)
  remoteService.on("device:disconnected", onDeviceDisconnected)

  await new Promise<void>((resolve) => {
    remoteService.once("session:stopped", () => {
      cleanupKeypress(handleKeypress)
      remoteService.off("device:connected", onDeviceConnected)
      remoteService.off("device:disconnected", onDeviceDisconnected)
      resolve()
    })
  })
}

async function keepMobileHostAlive(host: MobileHostRuntime): Promise<void> {
  await new Promise<void>((resolve) => {
    let closing = false
    const close = () => {
      if (closing) return
      closing = true
      process.off("SIGINT", close)
      process.off("SIGTERM", close)
      void stopMobileHost(host).finally(resolve)
    }

    process.once("SIGINT", close)
    process.once("SIGTERM", close)
  })
}

async function stopSessionAndCleanup(handler: (str: string, key: readline.Key) => void): Promise<void> {
  cleanupKeypress(handler)
  if (remoteService.hasActiveSession()) {
    await remoteService.stopSession().catch(() => {})
  }
}

function cleanupKeypress(handler: (str: string, key: readline.Key) => void): void {
  if (typeof process.stdin.setRawMode === "function") {
    process.stdin.setRawMode(false)
  }
  process.stdin.removeListener("keypress", handler)
}

async function ensureRemoteService(): Promise<void> {
  if (!remoteService.isInitialized()) {
    await remoteService.init()
  }
}

async function shareSession(): Promise<void> {
  const session = remoteService.getSession()

  if (!session || session.status === "stopped") {
    UI.println("No active remote session to share")
    return
  }

  const url = session.tunnelUrl || session.qrUrl
  UI.println("Share this link:")
  UI.println(url)

  await clipboardy.write(url).catch(() => {})
}
