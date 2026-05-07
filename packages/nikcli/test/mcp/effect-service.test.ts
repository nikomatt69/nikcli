import { afterAll, afterEach, describe, expect, it } from "bun:test"
import { Effect } from "effect"
import fs from "fs/promises"
import os from "os"
import path from "path"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-mcp-effect-home-"))
process.env.NIKCLI_TEST_HOME = testHome
process.env.NIKCLI_DISABLE_PROJECT_CONFIG = "1"
process.env.XDG_DATA_HOME = path.join(testHome, "data")
process.env.XDG_CACHE_HOME = path.join(testHome, "cache")
process.env.XDG_CONFIG_HOME = path.join(testHome, "config")
process.env.XDG_STATE_HOME = path.join(testHome, "state")

const { InstanceScope } = await import("@/effect")
const { MCP } = await import("@/mcp")
const { Instance } = await import("@/project/instance")

const projectDirs: string[] = []

async function makeProjectDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-mcp-effect-project-"))
  const resolved = await fs.realpath(dir)
  projectDirs.push(resolved)
  return resolved
}

describe("MCP.Service", () => {
  it("exposes empty MCP state through the Effect boundary without connecting external servers", async () => {
    const directory = await makeProjectDir()
    const result = await Effect.runPromise(
      InstanceScope.with(
        { directory },
        Effect.gen(function* () {
          const mcp = yield* MCP.Service
          const status = yield* mcp.status()
          const clients = yield* mcp.clients()
          const tools = yield* mcp.tools()
          const prompts = yield* mcp.prompts()
          const resources = yield* mcp.resources()
          const supportsOAuth = yield* mcp.supportsOAuth("missing")
          const hasStoredTokens = yield* mcp.hasStoredTokens("missing")
          const authStatus = yield* mcp.getAuthStatus("missing")

          return {
            authStatus,
            clients,
            hasStoredTokens,
            prompts,
            resources,
            status,
            supportsOAuth,
            tools,
          }
        }).pipe(Effect.provide(MCP.defaultLayer)),
      ),
    )

    expect(result.status).toEqual({})
    expect(result.clients).toEqual({})
    expect(result.tools).toEqual({})
    expect(result.prompts).toEqual({})
    expect(result.resources).toEqual({})
    expect(result.supportsOAuth).toBe(false)
    expect(result.hasStoredTokens).toBe(false)
    expect(result.authStatus).toBe("not_authenticated")
  })
})

afterEach(async () => {
  await Instance.disposeAll().catch(() => undefined)
})

afterAll(async () => {
  await Instance.disposeAll().catch(() => undefined)
  await Promise.all(projectDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })))
  await fs.rm(testHome, { recursive: true, force: true })
})
