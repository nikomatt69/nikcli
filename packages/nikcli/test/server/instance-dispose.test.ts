import { preserveTestEnv } from "../helpers/env"
import { afterAll, describe, expect, it } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-instance-dispose-home-"))
process.env.NIKCLI_TEST_HOME = testHome
process.env.NIKCLI_DISABLE_PROJECT_CONFIG = "1"

preserveTestEnv(["NIKCLI_TEST_HOME", "NIKCLI_DISABLE_PROJECT_CONFIG"])

const { Server } = await import("@/server/server")
const { isInstanceLessPath, requestedDirectory } = await import("@/server/httpapi/instance-less")

/**
 * `POST /instance/dispose` (H11).
 *
 * A request served *inside* an instance scope cannot await the destruction of that scope: its own
 * fiber runs on the runtime `Instance.dispose` tears down, so disposing from within interrupted the
 * responder and the endpoint answered 500 while its work had actually happened. `/instance` is an
 * instance-less root for that reason, which is what lets the 200 mean what it says.
 *
 * What is pinned here is the behaviour the TUI's provider flow depends on: it awaits this endpoint
 * after an auth change and expects the *next* request to see a rebuilt instance.
 */
const projectDirs: string[] = []

async function makeProjectDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-instance-dispose-project-"))
  const resolved = await fs.realpath(dir)
  projectDirs.push(resolved)
  return resolved
}

function url(pathname: string, directory: string) {
  const value = new URL(pathname, "http://nikcli.local")
  value.searchParams.set("directory", directory)
  return value
}

afterAll(async () => {
  for (const dir of projectDirs) await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined)
  await fs.rm(testHome, { recursive: true, force: true }).catch(() => undefined)
})

describe("POST /instance/dispose", () => {
  it("answers 200 rather than interrupting its own responder", async () => {
    const directory = await makeProjectDir()
    // Touch the instance first, so there is a runtime with live fibers to tear down.
    expect((await Server.fetch(new Request(url("/path", directory)))).status).toBe(200)

    const response = await Server.fetch(new Request(url("/instance/dispose", directory), { method: "POST" }))
    expect(response.status).toBe(200)
    expect(await response.json()).toBe(true)
  })

  it("leaves the next request able to rebuild the instance", async () => {
    const directory = await makeProjectDir()
    await Server.fetch(new Request(url("/path", directory)))
    await Server.fetch(new Request(url("/instance/dispose", directory), { method: "POST" }))

    const after = await Server.fetch(new Request(url("/path", directory)))
    expect(after.status).toBe(200)
    expect(((await after.json()) as { directory: string }).directory).toBe(directory)
  })

  it("is idempotent", async () => {
    const directory = await makeProjectDir()
    await Server.fetch(new Request(url("/path", directory)))
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await Server.fetch(new Request(url("/instance/dispose", directory), { method: "POST" }))
      expect(response.status).toBe(200)
    }
  })
})

describe("the routing decision that makes it possible", () => {
  it("serves /instance without binding an instance", () => {
    expect(isInstanceLessPath("/instance/dispose")).toBe(true)
    // Every root claims its bare path as well as its subtree.
    expect(isInstanceLessPath("/instance")).toBe(true)
    // Neighbouring instance-scoped routes must not be swept in by a prefix test.
    expect(isInstanceLessPath("/instances")).toBe(false)
    expect(isInstanceLessPath("/path")).toBe(false)
  })

  // Instance-less means the directory arrives as data, not as ambient context, so the handler reads
  // it with the same rule the middleware would have applied.
  it("reads the directory the request names, by query or header", () => {
    expect(requestedDirectory(new Request("http://nikcli.local/instance/dispose?directory=/tmp/a"))).toBe("/tmp/a")
    expect(
      requestedDirectory(
        new Request("http://nikcli.local/instance/dispose", { headers: { "x-nikcli-directory": "/tmp/b" } }),
      ),
    ).toBe("/tmp/b")
    expect(requestedDirectory(new Request("http://nikcli.local/instance/dispose?directory=%2Ftmp%2Fc"))).toBe("/tmp/c")
    expect(requestedDirectory(new Request("http://nikcli.local/instance/dispose"))).toBe(process.cwd())
  })
})
