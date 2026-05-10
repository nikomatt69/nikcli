import { Server } from "../../server/server"
import { UI } from "../ui"
import { cmd } from "./cmd"
import { withNetworkOptions, resolveNetworkOptions } from "../network"
import { Flag } from "../../flag/flag"
import open from "open"
import { networkInterfaces } from "os"

function getNetworkIPs() {
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

export const WebCommand = cmd({
  command: "web",
  builder: (yargs) => withNetworkOptions(yargs),
  describe: "start nikcli server and open web interface",
  handler: async (args) => {
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
        UI.println(
          UI.Style.TEXT_INFO_BOLD + "  mDNS:              ",
          UI.Style.TEXT_NORMAL,
          `nikcli.local:${server.port}`,
        )
      }

      open(localhostUrl.toString()).catch(() => {})
    } else {
      const displayUrl = server.url.toString()
      UI.println(UI.Style.TEXT_INFO_BOLD + "  Web interface:    ", UI.Style.TEXT_NORMAL, displayUrl)
      open(displayUrl).catch(() => {})
    }

    await new Promise(() => {})
    await server.stop()
  },
})
