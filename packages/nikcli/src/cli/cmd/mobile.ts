import { cmd } from "./cmd"
import { withNetworkOptions, resolveNetworkOptions } from "../network"
import { Server } from "@/server/server"
import { Flag } from "@/flag/flag"
import { MobileAuth } from "@/mobile/auth"

import { generateQR } from "@nikcli-ai/remote"
import { Installation } from "@/installation"
import { networkInterfaces } from "os"

function normalizePublicUrl(input?: string) {
  if (!input) return
  const url = new URL(input)
  return url.toString().replace(/\/$/, "")
}

function getLocalIPs(): string[] {
  const ips: string[] = []
  for (const iface of Object.values(networkInterfaces())) {
    if (!iface) continue
    for (const addr of iface) {
      if (addr.family === "IPv4" && !addr.internal) ips.push(addr.address)
    }
  }
  return ips
}

function isLoopbackHostname(hostname: string) {
  return hostname === "127.0.0.1" || hostname === "::1" || hostname === "localhost"
}

function resolveServerUrl(input: { publicUrl?: string; hostname: string; port: number }) {
  if (input.publicUrl) {
    const value = normalizePublicUrl(input.publicUrl)
    if (!value) throw new Error("Invalid public URL")
    return value
  }
  const isAllInterfaces = input.hostname === "0.0.0.0" || input.hostname === "::"
  const host = isAllInterfaces ? (getLocalIPs()[0] ?? input.hostname) : input.hostname
  return `http://${host}:${input.port}`
}

function printPairing(info: { serverUrl: string; token: string; directory?: string }) {
  const deepLink = new URL("nikcli://connect")
  deepLink.searchParams.set("server", info.serverUrl)
  deepLink.searchParams.set("token", info.token)
  if (info.directory) deepLink.searchParams.set("directory", info.directory)

  console.log("")
  console.log("Nikcli Mobile Pairing")
  console.log(`Server URL: ${info.serverUrl}`)
  console.log(`Token:      ${info.token}`)
  console.log(`Deep Link:  ${deepLink.toString()}`)
  console.log("")

  return generateQR(deepLink.toString())
}

export const MobileCommand = cmd({
  command: "mobile",
  describe: "mobile app host and pairing tools",
  builder: (yargs) =>
    yargs
      .command({
        command: "serve",
        describe: "start nikcli with mobile-friendly defaults",
        builder: (yargs) =>
          withNetworkOptions(yargs)
            .default("hostname", "0.0.0.0")
            .option("public-url", {
              type: "string",
              describe: "public HTTPS URL used by the mobile app outside your tailnet",
            })
            .option("pair", {
              type: "boolean",
              default: false,
              describe: "create and print a new mobile pairing token at startup",
            })
            .option("pair-name", {
              type: "string",
              default: "iphone",
              describe: "name for the generated pairing token",
            })
            .option("pair-expiry-days", {
              type: "number",
              describe: "optional token expiry in days",
            }),
        handler: async (args) => {
          const opts = await resolveNetworkOptions(args)
          const loopback = isLoopbackHostname(opts.hostname)
          const tailscaleAuthActive = Flag.NIKCLI_SERVER_TAILSCALE_AUTH && loopback
          const publicExposure = Boolean(args.publicUrl) || !loopback

          if (!Flag.NIKCLI_SERVER_PASSWORD && !tailscaleAuthActive) {
            if (publicExposure) {
              throw new Error(
                "Public mobile hosting requires NIKCLI_SERVER_PASSWORD. Set a server password before binding to a non-loopback address or using --public-url.",
              )
            }

            console.log(
              "Mobile mode without a server password is only safe on loopback. Set NIKCLI_SERVER_PASSWORD for LAN or public access.",
            )
          }

          const server = Server.listen(opts)
          const hostname = server.hostname || opts.hostname
          const port = server.port || opts.port || 4096
          const serverUrl = resolveServerUrl({
            publicUrl: args.publicUrl as string | undefined,
            hostname,
            port,
          })

          console.log(`nikcli mobile host listening on http://${hostname}:${port}`)
          if (serverUrl !== `http://${hostname}:${port}`) {
            console.log(`public mobile URL: ${serverUrl}`)
          }

          if (args.pair) {
            const created = await MobileAuth.create({
              name: String(args.pairName || "iphone"),
              expiresInDays: args.pairExpiryDays ? Number(args.pairExpiryDays) : undefined,
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
              const qr = await printPairing({ serverUrl: url, token: created.token, directory: process.cwd() })
              console.log(qr)
            }
          }

          await new Promise(() => { })

          await server.stop()
        },
      })
      .command({
        command: "pair",
        describe: "generate a mobile pairing token and QR code",
        builder: (yargs) =>
          yargs
            .option("public-url", {
              type: "string",
              demandOption: true,
              describe: "public server URL the mobile app should connect to",
            })
            .option("name", {
              type: "string",
              default: "iphone",
              describe: "token label",
            })
            .option("expiry-days", {
              type: "number",
              describe: "optional token expiry in days",
            })
            .option("directory", {
              type: "string",
              describe: "default directory or repo path for the paired app",
            }),
        handler: async (args) => {
          const created = await MobileAuth.create({
            name: String(args.name || "iphone"),
            expiresInDays: args.expiryDays ? Number(args.expiryDays) : undefined,
          })
          const serverUrl = normalizePublicUrl(String(args.publicUrl))
          if (!serverUrl) throw new Error("Invalid --public-url")
          const qr = await printPairing({
            serverUrl,
            token: created.token,
            directory: args.directory ? String(args.directory) : process.cwd(),
          })
          console.log(qr)
        },
      })
      .command({
        command: "token list",
        describe: "list mobile pairing tokens",
        handler: async () => {
          const tokens = await MobileAuth.list()
          if (!tokens.length) {
            console.log("No mobile tokens found")
            return
          }
          for (const token of tokens) {
            console.log(`${token.id}  ${token.name}  created=${new Date(token.createdAt).toISOString()}`)
          }
        },
      })
      .command({
        command: "token revoke <id>",
        describe: "revoke a mobile pairing token",
        builder: (yargs) =>
          yargs.positional("id", {
            type: "string",
            describe: "token id to revoke",
          }),
        handler: async (args) => {
          const ok = await MobileAuth.remove(String(args.id))
          if (!ok) throw new Error(`Token not found: ${args.id}`)
          console.log(`Revoked mobile token ${args.id}`)
        },
      })
      .demandCommand(),
  async handler() { },
})
