#!/usr/bin/env bun
/**
 * `nikcli-tui <url>` — the terminal, attached to a server it did not start.
 *
 * The whole point is what is *missing* from this file's import graph: no
 * `packages/nikcli`, no server, no database, no provider chain. It is the check
 * that `@nikcli-ai/tui` stands on its own, run as a program rather than argued
 * about in a document.
 */
import { StandaloneConfigError, startStandaloneTui } from "../src/host/standalone"

const url = process.argv[2]
if (!url) {
  console.error("usage: nikcli-tui <server-url> [session-id]")
  process.exit(2)
}

const ACTION: Record<string, string> = {
  unauthorized: "sign in on that server, or start it without auth",
  unavailable: "start a nikcli server there, or check the URL",
  malformed: "check that the server version matches this client",
}

try {
  await startStandaloneTui({ url, sessionID: process.argv[3], directory: process.cwd() })
} catch (error) {
  // Starting the renderer on default config would hide a server that is down,
  // rejecting us, or speaking a shape we cannot read.
  if (!(error instanceof StandaloneConfigError)) throw error
  console.error(`nikcli-tui: ${error.message}`)
  console.error(`  ${ACTION[error.reason]}`)
  process.exit(1)
}
