#!/usr/bin/env bun
/**
 * Standalone entry for bun compile → single executable (nikcli-remote).
 * Used by: bun build src/cli.ts --compile --outfile=dist/nikcli-remote
 */
import { parseArgs } from "util"
import { createRemoteServer } from "./index"

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      port: { type: "string", short: "p", default: "0" },
      host: { type: "string", short: "h", default: "0.0.0.0" },
      tunnel: { type: "boolean", short: "t", default: false },
      "max-connections": { type: "string", short: "c", default: "5" },
    },
  })

  const { server, session } = await createRemoteServer({
    port: parseInt(values.port as string, 10),
    host: values.host as string,
    enableTunnel: values.tunnel as boolean,
    enableTerminal: true,
    maxConnections: parseInt(values["max-connections"] as string, 10),
  })

  console.log("\nNikCLI Remote Terminal")
  console.log("======================")
  console.log(`Local URL:  ${session.localUrl}`)
  console.log(`Access URL: ${session.qrUrl}`) // qrUrl contains the ?t=token required

  if (session.tunnelUrl) {
    console.log(`Tunnel URL: ${session.tunnelUrl}?s=${session.id}&t=${server.getSessionSecret()}`)
  }

  console.log(`Session ID: ${session.id}`)
  console.log("\nPress Ctrl+C to stop")

  const cleanup = () => {
    server.stop().then(() => process.exit(0))
  }
  process.on("SIGINT", cleanup)
  process.on("SIGTERM", cleanup)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
