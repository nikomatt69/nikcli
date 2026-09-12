import { Runtime } from "../framework/runtime"
import { passthrough } from "../framework/args"
import { Commands } from "../commands"
import { Server } from "@/server/server"
import { UI } from "@/cli/ui"
import { resolveNetworkOptions } from "@/cli/network"
import { Flag } from "@nikcli-ai/util/flag"
import open from "open"
import { networkInterfaces } from "os"

export function getNetworkIPs() {
  const nets = networkInterfaces()
  const results: string[] = []

  for (const name of Object.keys(nets)) {
    const net = nets[name]
    if (!net) continue

    for (const netInfo of net) {
      if (netInfo.internal || netInfo.family !== "IPv4") continue
      if (netInfo.address.startsWith("172.")) continue
      results.push(netInfo.address)
    }
  }

  return results
}

export default Runtime.handler(Commands.commands["web"], async (input) => {
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    port: input["port"],
    hostname: input["hostname"],
    mdns: input["mdns"],
    cors: [...input["cors"]],
  }
  // SAFETY: this command's builder is `withNetworkOptions`, which declares
  // exactly the flags `resolveNetworkOptions` reads. yargs infers a wider
  // argv type than the builder guarantees.
  const opts = await resolveNetworkOptions(args as Parameters<typeof resolveNetworkOptions>[0])

  const loopback = opts.hostname === "127.0.0.1" || opts.hostname === "::1" || opts.hostname === "localhost"
  const tailscaleAuthActive = Flag.NIKCLI_SERVER_TAILSCALE_AUTH && loopback

  if (Flag.NIKCLI_SERVER_TAILSCALE_AUTH && !loopback) {
    UI.println(
      UI.Style.TEXT_WARNING_BOLD +
        "!  " +
        "NIKCLI_SERVER_TAILSCALE_AUTH is set but hostname is not loopback; Tailscale identity headers will not be trusted.",
    )
  }

  if (!Flag.NIKCLI_SERVER_PASSWORD && !tailscaleAuthActive) {
    UI.println(UI.Style.TEXT_WARNING_BOLD + "!  " + "NIKCLI_SERVER_PASSWORD is not set; server is unsecured.")
  }

  const server = Server.listen(opts)
  UI.empty()
  UI.println(UI.logo("  "))
  UI.empty()

  if (opts.hostname === "0.0.0.0") {
    const localhostUrl = `http://localhost:${server.port}`
    UI.println(UI.Style.TEXT_INFO_BOLD + "  Local access:      ", UI.Style.TEXT_NORMAL, localhostUrl)

    const networkIPs = getNetworkIPs()
    if (networkIPs.length > 0) {
      for (const ip of networkIPs) {
        UI.println(
          UI.Style.TEXT_INFO_BOLD + "  Network access:    ",
          UI.Style.TEXT_NORMAL,
          `http://${ip}:${server.port}`,
        )
      }
    }

    if (opts.mdns) {
      UI.println(UI.Style.TEXT_INFO_BOLD + "  mDNS:              ", UI.Style.TEXT_NORMAL, `nikcli.local:${server.port}`)
    }

    open(localhostUrl.toString()).catch(() => {})
  } else {
    const displayUrl = server.url.toString()
    UI.println(UI.Style.TEXT_INFO_BOLD + "  Web interface:    ", UI.Style.TEXT_NORMAL, displayUrl)
    open(displayUrl).catch(() => {})
  }

  await new Promise(() => {})
  await server.stop()
})
