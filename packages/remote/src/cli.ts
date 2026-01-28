#!/usr/bin/env bun
/**
 * Standalone entry for bun compile → single executable (nikcli-remote).
 * Used by: bun build src/cli.ts --compile --outfile=dist/nikcli-remote
 */
import { createRemoteServer } from "./index"

async function main() {
  const { server, session } = await createRemoteServer({
    port: 0,
    host: "0.0.0.0",
    enableTunnel: false,
    enableTerminal: true,
    maxConnections: 5,
  })
  console.log("NikCLI Remote server listening at", session.localUrl)
  console.log("Session ID:", session.id)
  console.log("Press Ctrl+C to stop")

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
