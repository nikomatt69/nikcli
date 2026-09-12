import { Runtime } from "../../framework/runtime"
import { passthrough } from "../../framework/args"
import { Commands } from "../../commands"
import { Server } from "@/server/server"

export default Runtime.handler(Commands.commands["companion"].commands["serve"], async (input) => {
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    "port": input["port"],
    "host": input["host"],
  }
  const port = args.port as number
  const host = args.host as string

  const os = await import("os")
  const interfaces = os.networkInterfaces()
  let localIp = "localhost"
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === "IPv4" && !iface.internal) {
        localIp = iface.address
        break
      }
    }
    if (localIp !== "localhost") break
  }

  console.log(`Starting nikcli server with companion on http://localhost:${port}`)
  console.log(`Access from mobile: http://${localIp}:${port}/companion`)

  Server.listen({ port, hostname: host, mdns: false })

  await new Promise(() => {})
})
