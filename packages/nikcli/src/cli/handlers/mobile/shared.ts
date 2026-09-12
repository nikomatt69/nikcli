import { resolveNetworkOptions } from "@/cli/network"
import { Server } from "@/server/server"
import { MobileAuth } from "@/mobile/auth"
import { generateQR } from "@nikcli-ai/remote"
import {
  buildMobilePairingDeepLink,
  getLocalIPs,
  isLoopbackHostname,
  normalizePublicUrl,
  resolveServerUrl,
} from "@nikcli-ai/util/mobile-pairing"
import type { NetworkOptions, ResolvedNetworkConfig } from "@/cli/network"

/** Helpers shared by the `mobile` commands. */

export { buildMobilePairingDeepLink, getLocalIPs, isLoopbackHostname, normalizePublicUrl, resolveServerUrl }

export async function printPairing(info: { serverUrl: string; token: string; directory?: string }) {
  const deepLink = buildMobilePairingDeepLink(info)

  console.log("")
  console.log("Nikcli Mobile Pairing")
  console.log(`Server URL: ${info.serverUrl}`)
  console.log(`Token:      ${info.token}`)
  console.log(`Deep Link:  ${deepLink}`)
  console.log("")

  return generateQR(deepLink)
}

export type MobileHostStartOptions = Partial<NetworkOptions> & {
  publicUrl?: string
  pair?: boolean
  pairName?: string
  pairExpiryDays?: number
  directory?: string
}

export type MobileHostRuntime = {
  server: ReturnType<typeof Server.listen>
  hostname: string
  port: number
  serverUrl: string
  network: ResolvedNetworkConfig
}

export async function startMobileHost(args: MobileHostStartOptions): Promise<MobileHostRuntime> {
  const opts = await resolveNetworkOptions(args)
  const server = Server.listen({
    ...opts,
    mobileAuthRequired: true,
  })
  try {
    const hostname = server.hostname || opts.hostname
    const port = server.port || opts.port || 4096
    const serverUrl = resolveServerUrl({
      publicUrl: args.publicUrl,
      hostname,
      port,
    })

    console.log(`nikcli mobile host listening on http://${hostname}:${port}`)
    if (serverUrl !== `http://${hostname}:${port}`) {
      console.log(`public mobile URL: ${serverUrl}`)
    }

    if (args.pair) {
      const created = await MobileAuth.create({
        name: args.pairName || "iphone",
        expiresInDays: args.pairExpiryDays,
      })

      const localIPs = getLocalIPs()
      const isAllInterfaces = opts.hostname === "0.0.0.0" || opts.hostname === "::"
      const pairingIPs = args.publicUrl
        ? [serverUrl]
        : isAllInterfaces && localIPs.length > 0
          ? localIPs.map((ip) => `http://${ip}:${port}`)
          : [serverUrl]

      for (let i = 0; i < pairingIPs.length; i++) {
        const url = pairingIPs[i]
        if (pairingIPs.length > 1) console.log(`--- Interface ${i + 1}/${pairingIPs.length}: ${url} ---`)
        const qr = await printPairing({
          serverUrl: url,
          token: created.token,
          directory: args.directory ?? process.cwd(),
        })
        console.log(qr)
      }
    }

    return { server, hostname, port, serverUrl, network: opts }
  } catch (error) {
    await server.stop(true).catch(() => undefined)
    throw error
  }
}

export async function stopMobileHost(host: MobileHostRuntime | undefined) {
  await host?.server.stop(true)
}
