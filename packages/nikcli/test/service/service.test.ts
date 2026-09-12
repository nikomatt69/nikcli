import { preserveTestEnv } from "../helpers/env"
import { afterEach, describe, expect, it } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { removeTestDir } from "../helpers/fs"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-service-home-"))
process.env.NIKCLI_TEST_HOME = testHome
process.env.NIKCLI_DISABLE_PROJECT_CONFIG = "1"
process.env.XDG_DATA_HOME = path.join(testHome, "data")
process.env.XDG_CACHE_HOME = path.join(testHome, "cache")
process.env.XDG_CONFIG_HOME = path.join(testHome, "config")
process.env.XDG_STATE_HOME = path.join(testHome, "state")

preserveTestEnv([
  "NIKCLI_TEST_HOME",
  "NIKCLI_DISABLE_PROJECT_CONFIG",
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",
  "XDG_CONFIG_HOME",
  "XDG_STATE_HOME",
])

const { Global } = await import("@nikcli-ai/util/global")
const { BackgroundService } = await import("@/service/service")

const registrationPath = () => path.join(Global.Path.state, BackgroundService.filename())

async function writeRegistration(value: unknown) {
  await fs.mkdir(Global.Path.state, { recursive: true })
  await fs.writeFile(registrationPath(), typeof value === "string" ? value : JSON.stringify(value))
}

async function registrationExists() {
  return fs
    .access(registrationPath())
    .then(() => true)
    .catch(() => false)
}

/** A port nothing is listening on, so the health probe is guaranteed to fail. */
const DEAD_URL = "http://127.0.0.1:9"

afterEach(async () => {
  await fs.rm(registrationPath(), { force: true }).catch(() => {})
})

describe("BackgroundService.discover", () => {
  it("reports nothing when no registration exists", async () => {
    expect(await BackgroundService.discover()).toBeUndefined()
  })

  it("removes a registration whose process is gone", async () => {
    // A pid this high is beyond every platform's default pid_max, so it cannot
    // collide with a real process and make the test pass for the wrong reason.
    await writeRegistration({ pid: 4_194_303, url: DEAD_URL, version: "x", startedAt: 1 })
    expect(await BackgroundService.discover()).toBeUndefined()
    expect(await registrationExists()).toBe(false)
  })

  it("removes a registration whose process is alive but unreachable", async () => {
    // This test process is certainly alive, and nothing answers on DEAD_URL —
    // exactly the shape of a service that crashed and had its pid reused.
    await writeRegistration({ pid: process.pid, url: DEAD_URL, version: "x", startedAt: 1 })
    expect(await BackgroundService.discover()).toBeUndefined()
    expect(await registrationExists()).toBe(false)
  })

  it("ignores a corrupt registration instead of throwing", async () => {
    await writeRegistration("this is not json")
    expect(await BackgroundService.discover()).toBeUndefined()
  })

  it("ignores a registration missing the fields it needs", async () => {
    await writeRegistration({ url: DEAD_URL })
    expect(await BackgroundService.discover()).toBeUndefined()
  })
})

describe("BackgroundService.status", () => {
  it("reports not running with no registration", async () => {
    const status = await BackgroundService.status()
    expect(status.running).toBe(false)
    expect(status.registration).toBeUndefined()
    expect(status.file).toBe(registrationPath())
  })
})

describe("per-channel isolation", () => {
  it("keeps shared channels on one file and gives every other channel its own", () => {
    for (const channel of ["latest", "dev", "beta", "next"]) {
      expect(BackgroundService.filename(channel)).toBe("service.json")
    }
    // A local dev build must not discover — and restart — an installed release.
    expect(BackgroundService.filename("local")).toBe("service-local.json")
    expect(BackgroundService.filename("pr-123")).toBe("service-pr-123.json")
  })

  it("sanitises a channel name into a filename that cannot leave the state directory", () => {
    expect(BackgroundService.filename("feat/some thing")).toBe("service-feat-some-thing.json")
    // Dots survive the whitelist, which is fine: what matters is that no path
    // separator does, so the result is always a plain name in the state dir.
    for (const hostile of ["../escape", "..", "a/../../b", "c:\\windows", "x\u0000y"]) {
      const name = BackgroundService.filename(hostile)
      expect(name).not.toContain("/")
      expect(name).not.toContain("\\")
      expect(path.basename(name)).toBe(name)
    }
  })

  it("gives each channel a distinct, in-range default port", () => {
    expect(BackgroundService.defaultPort("latest")).toBe(0xc0de)
    expect(BackgroundService.defaultPort("local")).toBe(0xc0df)
    const custom = BackgroundService.defaultPort("some-branch")
    expect(custom).toBeGreaterThanOrEqual(10_000)
    expect(custom).toBeLessThan(60_000)
    expect(BackgroundService.defaultPort("some-branch")).toBe(custom)
    expect(BackgroundService.defaultPort("another-branch")).not.toBe(custom)
  })
})

describe("versionBelongsToChannel", () => {
  it("accepts the installed version exactly", () => {
    expect(BackgroundService.versionBelongsToChannel("1.2.3", "latest", "1.2.3")).toBe(true)
  })

  it("accepts any build counter on the same preview channel", () => {
    // Otherwise every rebuild reads as version skew and restarts the service,
    // so the engine never actually stays warm on a preview channel.
    expect(BackgroundService.versionBelongsToChannel("0.0.0-mychan-42", "mychan", "0.0.0-mychan-41")).toBe(true)
  })

  it("rejects another channel's build and a missing version", () => {
    expect(BackgroundService.versionBelongsToChannel("0.0.0-other-42", "mychan", "0.0.0-mychan-41")).toBe(false)
    expect(BackgroundService.versionBelongsToChannel(undefined, "mychan", "0.0.0-mychan-41")).toBe(false)
  })
})

describe("BackgroundService.stop", () => {
  it("is a no-op when nothing is registered", async () => {
    expect(await BackgroundService.stop()).toBe(false)
  })

  it("clears the registration of a process that is already gone", async () => {
    await writeRegistration({ pid: 4_194_303, url: DEAD_URL, version: "x", startedAt: 1 })
    expect(await BackgroundService.stop()).toBe(false)
    expect(await registrationExists()).toBe(false)
  })
})

describe("BackgroundService.register", () => {
  it("writes an owned registration and cleans it up through the disposer", async () => {
    const release = await BackgroundService.register("http://127.0.0.1:4096")
    const raw = JSON.parse(await fs.readFile(registrationPath(), "utf8"))
    expect(raw.pid).toBe(process.pid)
    expect(raw.url).toBe("http://127.0.0.1:4096")
    expect(typeof raw.id).toBe("string")
    expect(raw.id.length).toBeGreaterThan(0)
    await release()
    expect(await registrationExists()).toBe(false)
  })

  it("leaves no temp file behind (the write is a rename, not an append)", async () => {
    const release = await BackgroundService.register("http://127.0.0.1:4096")
    const entries = await fs.readdir(Global.Path.state)
    expect(entries.filter((name) => name.endsWith(".tmp"))).toEqual([])
    await release()
  })

  it("does not delete a registration it no longer owns", async () => {
    // An older instance exiting must not take the newer one's entry with it,
    // or the survivor becomes undiscoverable while still serving.
    const release = await BackgroundService.register("http://127.0.0.1:4096")
    const successor = { id: "someone-else", pid: process.pid, url: "http://127.0.0.1:5000", version: "x", startedAt: 2 }
    await writeRegistration(successor)
    await release()
    expect(await registrationExists()).toBe(true)
    expect(JSON.parse(await fs.readFile(registrationPath(), "utf8")).id).toBe("someone-else")
  })
})

describe("BackgroundService.health", () => {
  it("returns the version of a healthy server", async () => {
    const server = Bun.serve({
      port: 0,
      fetch: (request) =>
        new URL(request.url).pathname === "/global/health"
          ? Response.json({ healthy: true, version: "1.2.3" })
          : new Response("no", { status: 404 }),
    })
    try {
      expect(await BackgroundService.health(server.url.origin)).toEqual({ version: "1.2.3" })
    } finally {
      server.stop(true)
    }
  })

  it("treats a server that answers without `healthy: true` as down", async () => {
    // A 200 is not enough: an unrelated process on the port, or a half-started
    // server, can answer. The body is the contract.
    const server = Bun.serve({ port: 0, fetch: () => Response.json({ version: "1.2.3" }) })
    try {
      expect(await BackgroundService.health(server.url.origin)).toBeUndefined()
    } finally {
      server.stop(true)
    }
  })

  it("returns undefined instead of throwing when nothing answers", async () => {
    expect(await BackgroundService.health(DEAD_URL, 250)).toBeUndefined()
  })
})

process.on("beforeExit", () => {
  void removeTestDir(testHome)
})
