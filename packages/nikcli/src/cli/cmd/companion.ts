import { cmd } from "./cmd"
import open from "open"
import { Server } from "../../server/server"

export const CompanionCommand = cmd({
  command: "companion",
  describe: "Web UI for nikcli sessions",
  builder: (yargs) =>
    yargs
      .command({
        command: "serve",
        describe: "Start the nikcli server with companion UI",
        builder: (yargs) =>
          yargs
            .option("port", {
              describe: "Port to run the server on",
              type: "number",
              default: 4096,
            })
            .option("host", {
              describe: "Host to bind to",
              type: "string",
              default: "0.0.0.0",
            }),
        handler: async (args) => {
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
        },
      })
      .command({
        command: "open",
        describe: "Open the companion UI in browser",
        builder: (yargs) =>
          yargs
            .option("port", {
              describe: "Port where server is running",
              type: "number",
              default: 4096,
            })
            .option("session", {
              describe: "Session ID to connect to",
              type: "string",
            }),
        handler: async (args) => {
          const port = args.port as number
          const session = args.session as string | undefined

          let url = `http://localhost:${port}/companion`
          if (session) {
            url += `?session=${session}`
          }

          await open(url)
          console.log(`Opening ${url}`)
        },
      }),
  handler: async () => {
    console.log("Use 'nikcli companion serve' to start the server with companion UI")
    console.log("Use 'nikcli companion open' to open the companion UI")
  },
})
