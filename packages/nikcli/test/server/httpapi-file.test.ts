import { preserveTestEnv } from "../helpers/env"
import { afterAll, afterEach, describe, expect, it } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-httpapi-file-home-"))
process.env.NIKCLI_TEST_HOME = testHome
process.env.NIKCLI_DISABLE_PROJECT_CONFIG = "1"
process.env.NIKCLI_EXPERIMENTAL_HTTPAPI = "1"
process.env.XDG_DATA_HOME = path.join(testHome, "data")
process.env.XDG_CACHE_HOME = path.join(testHome, "cache")
process.env.XDG_CONFIG_HOME = path.join(testHome, "config")
process.env.XDG_STATE_HOME = path.join(testHome, "state")

preserveTestEnv([
  "NIKCLI_TEST_HOME",
  "NIKCLI_DISABLE_PROJECT_CONFIG",
  "NIKCLI_EXPERIMENTAL_HTTPAPI",
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",
  "XDG_CONFIG_HOME",
  "XDG_STATE_HOME",
])

const { Instance } = await import("@/project/instance")
const { Server } = await import("@/server/server")
const { HttpApiBridge } = await import("@/server/httpapi/bridge")

const projectDirs: string[] = []

async function makeProjectDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-httpapi-file-project-"))
  const resolved = await fs.realpath(dir)
  projectDirs.push(resolved)
  return resolved
}

async function request(pathname: string, directory: string, params: Record<string, string> = {}) {
  const url = new URL(pathname, "http://nikcli.local")
  url.searchParams.set("directory", directory)
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value)
  }
  const response = await Server.App().fetch(new Request(url))
  expect(response.status).toBe(200)
  return response.json()
}

describe("File HttpApi bridge", () => {
  it("serves file search, list, content, symbol, and status routes behind NIKCLI_EXPERIMENTAL_HTTPAPI", async () => {
    const directory = await makeProjectDir()
    await fs.mkdir(path.join(directory, "src"), { recursive: true })
    await fs.writeFile(path.join(directory, "src", "sample.ts"), "export const sampleValue = 42\n")

    const textMatches = (await request("/find", directory, { pattern: "sampleValue" })) as Array<{
      path: { text: string }
      lines: { text: string }
    }>
    expect(textMatches.some((match) => match.path.text.endsWith("src/sample.ts"))).toBe(true)

    // `/find` above returns `/`-separated paths while `/find/file` returns the
    // host's separator, so the two endpoints of the same API disagree on Windows.
    // Compared separator-agnostically here so the case tests discovery rather
    // than that inconsistency — which is worth settling on the API side, not by
    // pinning one endpoint's current behaviour in a test.
    const sameFile = (value: string) => value.replace(/\\/g, "/").endsWith("src/sample.ts")

    let fileMatches: string[] = []
    for (let attempt = 0; attempt < 5; attempt++) {
      fileMatches = (await request("/find/file", directory, {
        query: "sample",
        type: "file",
        limit: "20",
      })) as string[]
      if (fileMatches.some(sameFile)) break
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    expect(fileMatches.some(sameFile)).toBe(true)

    const symbols = (await request("/find/symbol", directory, { query: "sample" })) as unknown[]
    expect(symbols).toEqual([])

    const nodes = (await request("/file", directory, { path: "." })) as Array<{ name: string; type: string }>
    expect(nodes).toContainEqual(expect.objectContaining({ name: "src", type: "directory" }))

    const content = (await request("/file/content", directory, { path: "src/sample.ts" })) as { content: string }
    expect(content.content).toBe("export const sampleValue = 42")

    const status = (await request("/file/status", directory)) as unknown[]
    expect(status).toEqual([])

    expect(HttpApiBridge.supports("/file/content", "PUT")).toBe(true)
    const writeUrl = new URL("/file/content", "http://nikcli.local")
    writeUrl.searchParams.set("directory", directory)
    const writeResponse = await Server.App().fetch(
      new Request(writeUrl, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: "src/written.ts", content: "export const written = true\n" }),
      }),
    )
    expect(writeResponse.status).toBe(200)
    expect(await writeResponse.json()).toEqual({ success: true })
    expect(await fs.readFile(path.join(directory, "src", "written.ts"), "utf8")).toBe("export const written = true\n")
  })
})

afterEach(async () => {
  await Instance.disposeAll().catch(() => undefined)
})

afterAll(async () => {
  delete process.env.NIKCLI_EXPERIMENTAL_HTTPAPI
  await Instance.disposeAll().catch(() => undefined)
  await Promise.all(projectDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })))
  await fs.rm(testHome, { recursive: true, force: true })
})
