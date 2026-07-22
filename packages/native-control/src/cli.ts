#!/usr/bin/env bun
import { mkdir, copyFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { homedir } from "node:os"
import { ensureDaemon, rpc, shutdownDaemon, socketPathFor } from "./daemon-client"

const HELP = `native-control COMMAND [options]

Persistent native UI sessions, following terminal-control/browser-control semantics.

  native-control start [NAME] --url URL
  native-control list
  native-control open NAME --json SURFACE
  native-control update NAME --json SURFACE
  native-control wait NAME [--surface ID] [--event TYPE] [--timeout MS]
  native-control snapshot NAME
  native-control dispatch NAME --json EVENT
  native-control close NAME SURFACE_ID
  native-control stop NAME
  native-control remove NAME
  native-control close-all
  native-control install-skill [--global | --workspace DIR]
  native-control host [--url URL] [--interval-ms N]
  native-control shutdown
`

function take(args: string[], flag: string) {
  const value = args.shift()
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`)
  return value
}

async function call<T>(method: string, params: Record<string, unknown> = {}) {
  const socket = await socketPathFor()
  await ensureDaemon(socket)
  return rpc<T>(socket, method, params)
}

async function installSkill(args: string[]) {
  const global = args.includes("--global")
  const workspaceIndex = args.indexOf("--workspace")
  const root = global
    ? homedir()
    : resolve(workspaceIndex >= 0 ? take(args.slice(workspaceIndex + 1), "--workspace") : process.cwd())
  const target = join(root, ".agents", "skills", "native-ui", "SKILL.md")
  await mkdir(dirname(target), { recursive: true })
  await copyFile(resolve(import.meta.dir, "../skills/native-ui/SKILL.md"), target)
  return { installed: target }
}

async function main() {
  const args = Bun.argv.slice(2)
  const command = args.shift()
  if (!command || command === "--help" || command === "-h") return process.stdout.write(HELP)
  if (command === "install-skill") return print(await installSkill(args))
  if (command === "host") {
    const child = Bun.spawn(
      ["cargo", "run", "--manifest-path", resolve(import.meta.dir, "../native-host/Cargo.toml"), "--", ...args],
      { stdin: "inherit", stdout: "inherit", stderr: "inherit" },
    )
    process.exit(await child.exited)
  }
  if (command === "shutdown") return shutdownDaemon(await socketPathFor())
  if (command === "list" || command === "close-all")
    return print(await call(command === "close-all" ? "closeAll" : "list"))

  const name = take(args, command)
  if (command === "start") {
    let url = "http://127.0.0.1:4096"
    while (args.length) {
      const flag = args.shift()!
      if (flag === "--url") url = take(args, flag)
      else throw new Error(`Unknown option: ${flag}`)
    }
    return print(await call("start", { name, url }))
  }
  if (command === "snapshot" || command === "stop" || command === "remove") return print(await call(command, { name }))
  if (command === "close") return print(await call("close", { name, surfaceID: take(args, command) }))

  if (command === "open" || command === "update" || command === "dispatch") {
    if (args.shift() !== "--json") throw new Error(`${command} requires --json`)
    const value = JSON.parse(take(args, "--json"))
    return print(
      await call(command, {
        name,
        [command === "dispatch" ? "event" : "surface"]: value,
      }),
    )
  }
  if (command === "wait") {
    const condition: Record<string, unknown> = {}
    while (args.length) {
      const flag = args.shift()!
      if (flag === "--surface") condition.surfaceID = take(args, flag)
      else if (flag === "--event") condition.event = take(args, flag)
      else if (flag === "--timeout") condition.timeout = Number(take(args, flag))
      else throw new Error(`Unknown option: ${flag}`)
    }
    return print(await call("wait", { name, condition }))
  }
  throw new Error(`Unknown command: ${command}`)
}

function print(value: unknown) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
})
