import { Option } from "effect"
import { Runtime } from "../../framework/runtime"
import { passthrough } from "../../framework/args"
import { Commands } from "../../commands"
import { withInstanceAsync } from "@/effect"
import { UI } from "@/cli/ui"
import { remoteService, qrRenderer, type RemoteSession, type SessionOptions } from "@nikcli-ai/util/remote-tunnel"
import { type TunnelProvider } from "@nikcli-ai/remote"
import { startMobileHost, stopMobileHost, type MobileHostRuntime } from "@/cli/handlers/mobile/shared"
import { resolveCloudOptions, maybeCreateTunnel, setupKeyboardControl, keepMobileHostAlive, ensureRemoteService } from "./shared"

export default Runtime.handler(Commands.commands["remote"].commands["start"], async (input) => {
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    "port": input["port"],
    "hostname": input["hostname"],
    "mdns": input["mdns"],
    "cors": [...input["cors"]],
    "name": Option.getOrUndefined(input["name"]),
    "timeout": input["timeout"],
    "no-tunnel": input["no-tunnel"],
    "noTunnel": input["no-tunnel"],
    "provider": Option.getOrUndefined(input["provider"]),
    "cloud": input["cloud"],
    "cloud-url": Option.getOrUndefined(input["cloud-url"]),
    "cloudUrl": Option.getOrUndefined(input["cloud-url"]),
    "cloud-token": Option.getOrUndefined(input["cloud-token"]),
    "cloudToken": Option.getOrUndefined(input["cloud-token"]),
    "cloud-device-id": Option.getOrUndefined(input["cloud-device-id"]),
    "cloudDeviceId": Option.getOrUndefined(input["cloud-device-id"]),
    "cloud-session-id": Option.getOrUndefined(input["cloud-session-id"]),
    "cloudSessionId": Option.getOrUndefined(input["cloud-session-id"]),
    "cloud-public-key": Option.getOrUndefined(input["cloud-public-key"]),
    "cloudPublicKey": Option.getOrUndefined(input["cloud-public-key"]),
    "mobile": input["mobile"],
    "mobile-only": input["mobile-only"],
    "mobileOnly": input["mobile-only"],
    "public-url": Option.getOrUndefined(input["public-url"]),
    "publicUrl": Option.getOrUndefined(input["public-url"]),
    "pair": input["pair"],
    "pair-name": input["pair-name"],
    "pairName": input["pair-name"],
    "pair-expiry-days": Option.getOrUndefined(input["pair-expiry-days"]),
    "pairExpiryDays": Option.getOrUndefined(input["pair-expiry-days"]),
  }
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
})
