import { describe, expect, test } from "bun:test"
import { access } from "node:fs/promises"
import { basename } from "node:path"
import {
  INTERNAL_DAEMON_FLAG,
  isCompiledBinaryHost,
  resolveDaemonLaunch,
  resolveDaemonSpawn,
  socketPathFor,
} from "../src/daemon-client"

describe("browser-control daemon-client", () => {
  test("socketPathFor hashes the workspace root", async () => {
    const a = await socketPathFor("/tmp/browser-control-ws-a")
    const b = await socketPathFor("/tmp/browser-control-ws-b")
    expect(a).not.toBe(b)
    expect(basename(a)).toStartWith("browser-control-")
    expect(a).toEndWith(".sock")
  })

  test("isCompiledBinaryHost detects bunfs paths", () => {
    expect(isCompiledBinaryHost("/$bunfs/root/daemon-client.js")).toBe(true)
    expect(isCompiledBinaryHost("B:\\~BUN\\root\\daemon-client.js")).toBe(true)
    expect(isCompiledBinaryHost("/Volumes/SSD/Projects/nikcli/packages/browser-control/src")).toBe(false)
  })

  test("resolveDaemonLaunch uses spawn when daemon.ts is on disk", async () => {
    // Source tree: not a compiled host.
    expect(isCompiledBinaryHost()).toBe(false)
    const launch = await resolveDaemonLaunch()
    expect(launch.mode).toBe("spawn")
    if (launch.mode !== "spawn") return
    const argv = launch.argv("/tmp/browser-control-test.sock")
    expect(argv.length).toBe(4)
    expect(argv[1]).toEndWith("daemon.ts")
    expect(argv[2]).toBe("--socket")
    await access(argv[1]!)
  })

  test("resolveDaemonSpawn still returns a spawn argv in source trees", async () => {
    const sock = "/tmp/browser-control-test.sock"
    const argv = await resolveDaemonSpawn(sock)
    expect(argv[1]).toEndWith("daemon.ts")
    expect(argv[3]).toBe(sock)
  })

  test("INTERNAL_DAEMON_FLAG is stable", () => {
    expect(INTERNAL_DAEMON_FLAG).toBe("--browser-control-daemon")
  })
})
