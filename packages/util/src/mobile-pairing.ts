import { networkInterfaces } from "os"

/**
 * Pairing a phone with a nikcli server: where the server is reachable, and the link that carries
 * that address plus a token to the app.
 *
 * Pure string and interface work, extracted from the `mobile` CLI command. The TUI's pairing
 * dialog wanted exactly these three helpers and was importing the command module for them, which
 * pulled in `Server` and `MobileAuth` — the whole server — to build a URL.
 */
export function normalizePublicUrl(input?: string) {
  if (!input) return
  const url = new URL(input)
  return url.toString().replace(/\/$/, "")
}

export function getLocalIPs(): string[] {
  const ips: string[] = []
  for (const iface of Object.values(networkInterfaces())) {
    if (!iface) continue
    for (const addr of iface) {
      if (addr.family === "IPv4" && !addr.internal) ips.push(addr.address)
    }
  }
  return ips
}

export function isLoopbackHostname(hostname: string) {
  return hostname === "127.0.0.1" || hostname === "::1" || hostname === "localhost"
}

export function resolveServerUrl(input: { publicUrl?: string; hostname: string; port: number }) {
  if (input.publicUrl) {
    const value = normalizePublicUrl(input.publicUrl)
    if (!value) throw new Error("Invalid public URL")
    return value
  }
  const isAllInterfaces = input.hostname === "0.0.0.0" || input.hostname === "::"
  const host = isAllInterfaces ? (getLocalIPs()[0] ?? input.hostname) : input.hostname
  return `http://${host}:${input.port}`
}

export function buildMobilePairingDeepLink(info: { serverUrl: string; token: string; directory?: string }) {
  const deepLink = new URL("nikcli://connect")
  deepLink.searchParams.set("server", info.serverUrl)
  deepLink.searchParams.set("token", info.token)
  if (info.directory) deepLink.searchParams.set("directory", info.directory)
  return deepLink.toString()
}
