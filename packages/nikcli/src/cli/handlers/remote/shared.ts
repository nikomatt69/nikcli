import { UI } from "@/cli/ui"
import { remoteService, qrRenderer, type RemoteSession, type SessionOptions } from "@nikcli-ai/util/remote-tunnel"
import { createTunnel, checkTunnelAvailability, probeTunnel, type TunnelProvider } from "@nikcli-ai/remote"
import { stopMobileHost, type MobileHostRuntime } from "@/cli/handlers/mobile/shared"
import readline from "node:readline"
import clipboardy from "clipboardy"
import os from "node:os"

/** Helpers shared by the `remote` commands. */

export function showRemoteHelp(): void {
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

export function resolveCloudOptions(args: Record<string, unknown>): SessionOptions["cloud"] | undefined {
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

export async function maybeCreateTunnel(
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

export async function setupKeyboardControl(session: RemoteSession): Promise<void> {
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

export async function keepMobileHostAlive(host: MobileHostRuntime): Promise<void> {
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

export async function stopSessionAndCleanup(handler: (str: string, key: readline.Key) => void): Promise<void> {
  cleanupKeypress(handler)
  if (remoteService.hasActiveSession()) {
    await remoteService.stopSession().catch(() => {})
  }
}

export function cleanupKeypress(handler: (str: string, key: readline.Key) => void): void {
  if (typeof process.stdin.setRawMode === "function") {
    process.stdin.setRawMode(false)
  }
  process.stdin.removeListener("keypress", handler)
}

export async function ensureRemoteService(): Promise<void> {
  if (!remoteService.isInitialized()) {
    await remoteService.init()
  }
}

export async function shareSession(): Promise<void> {
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
