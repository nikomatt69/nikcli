#!/usr/bin/env bun
/**
 * `nikcli-tui <url>` — the terminal, attached to a server it did not start.
 *
 * The whole point is what is *missing* from this file's import graph: no
 * `packages/nikcli`, no server, no database, no provider chain. It is the check
 * that `@nikcli-ai/tui` stands on its own, run as a program rather than argued
 * about in a document.
 */
import { startStandaloneTui } from "../src/host/standalone"

const url = process.argv[2]
if (!url) {
  console.error("usage: nikcli-tui <server-url> [session-id]")
  process.exit(2)
}

await startStandaloneTui({ url, sessionID: process.argv[3], directory: process.cwd() })
