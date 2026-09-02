import { preserveTestEnv } from "../helpers/env"
import { afterAll, afterEach, beforeEach, describe, expect, it } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-network-home-"))
process.env.NIKCLI_TEST_HOME = testHome
process.env.XDG_CONFIG_HOME = path.join(testHome, "xdg-config")

preserveTestEnv(["NIKCLI_TEST_HOME", "XDG_CONFIG_HOME"])
await fs.mkdir(path.join(process.env.XDG_CONFIG_HOME, "nikcli"), { recursive: true })

await import("@/config/config")
const { Global } = await import("@nikcli-ai/util/global")
const { resolveNetworkOptions } = await import("@/cli/network")

const globalConfigPath = path.join(Global.Path.config, "nikcli.json")

async function writeGlobalConfig(content: Record<string, unknown>) {
  await fs.mkdir(Global.Path.config, { recursive: true })
  await Bun.write(globalConfigPath, JSON.stringify(content, null, 2))
}

afterAll(async () => {
  await fs.rm(testHome, { recursive: true, force: true })
})

describe("resolveNetworkOptions", () => {
  let savedArgv: string[]
  let savedTerminal: string | undefined

  beforeEach(async () => {
    savedArgv = [...process.argv]
    savedTerminal = process.env.NIKCLI_TERMINAL
    delete process.env.PORT
    delete process.env.NIKCLI_TERMINAL
    await writeGlobalConfig({})
  })

  afterEach(() => {
    process.argv = savedArgv
    delete process.env.PORT
    if (savedTerminal === undefined) delete process.env.NIKCLI_TERMINAL
    else process.env.NIKCLI_TERMINAL = savedTerminal
  })

  it("uses yargs defaults when no config, flags, or PORT", async () => {
    process.argv = ["bun", "cli"]
    const r = await resolveNetworkOptions({
      port: 0,
      hostname: "127.0.0.1" as unknown as string,
      mdns: false,
      cors: [],
    })
    expect(r.port).toBe(0)
    expect(r.hostname).toBe("127.0.0.1")
    expect(r.mdns).toBe(false)
    expect(r.cors).toEqual([])
  })

  it("reads port, hostname, mdns, and cors from global config when argv has no overrides", async () => {
    process.argv = ["bun", "cli"]
    await writeGlobalConfig({
      server: {
        port: 9000,
        hostname: "192.168.1.1",
        mdns: true,
        cors: ["https://one.example"],
      },
    })
    const r = await resolveNetworkOptions({
      port: 0,
      hostname: "127.0.0.1" as unknown as string,
      mdns: false,
      cors: [],
    })
    expect(r.port).toBe(9000)
    expect(r.hostname).toBe("192.168.1.1")
    expect(r.mdns).toBe(true)
    expect(r.cors).toEqual(["https://one.example"])
  })

  it("prefers explicit --port in argv over config and PORT env", async () => {
    process.argv = ["bun", "cli", "--port", "3000"]
    process.env.PORT = "5000"
    await writeGlobalConfig({ server: { port: 9000 } })
    const r = await resolveNetworkOptions({
      port: 3000,
      hostname: "127.0.0.1" as unknown as string,
      mdns: false,
      cors: [],
    })
    expect(r.port).toBe(3000)
  })

  it("uses PORT env when port not in config and argv has no --port", async () => {
    process.argv = ["bun", "cli"]
    process.env.PORT = "7777"
    await writeGlobalConfig({})
    const r = await resolveNetworkOptions({
      port: 0,
      hostname: "127.0.0.1" as unknown as string,
      mdns: false,
      cors: [],
    })
    expect(r.port).toBe(7777)
  })

  it("ignores implicit server config and PORT inside a managed mobile terminal", async () => {
    process.argv = ["bun", "cli"]
    process.env.PORT = "4096"
    process.env.NIKCLI_TERMINAL = "1"
    await writeGlobalConfig({
      server: {
        port: 9000,
        hostname: "0.0.0.0",
        mdns: true,
      },
    })

    const r = await resolveNetworkOptions({
      port: 0,
      hostname: "127.0.0.1",
      mdns: false,
      cors: [],
    })

    expect(r.port).toBe(0)
    expect(r.hostname).toBe("127.0.0.1")
    expect(r.mdns).toBe(false)
  })

  it("respects an explicit --port inside a managed mobile terminal", async () => {
    process.argv = ["bun", "cli", "--port", "3000"]
    process.env.PORT = "4096"
    process.env.NIKCLI_TERMINAL = "1"

    const r = await resolveNetworkOptions({
      port: 3000,
      hostname: "127.0.0.1",
      mdns: false,
      cors: [],
    })

    expect(r.port).toBe(3000)
  })

  it("sets hostname to 0.0.0.0 when mdns is on from config and hostname is unset in config", async () => {
    process.argv = ["bun", "cli"]
    await writeGlobalConfig({ server: { mdns: true } })
    const r = await resolveNetworkOptions({
      port: 0,
      hostname: "127.0.0.1" as unknown as string,
      mdns: false,
      cors: [],
    })
    expect(r.mdns).toBe(true)
    expect(r.hostname).toBe("0.0.0.0")
  })

  it("appends argv cors to config cors", async () => {
    process.argv = ["bun", "cli", "--cors", "https://b.example"]
    await writeGlobalConfig({ server: { cors: ["https://a.example"] } })
    const r = await resolveNetworkOptions({
      port: 0,
      hostname: "127.0.0.1" as unknown as string,
      mdns: false,
      cors: ["https://b.example"],
    })
    expect(r.cors).toEqual(["https://a.example", "https://b.example"])
  })
})
