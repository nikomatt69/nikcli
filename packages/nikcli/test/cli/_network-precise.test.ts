import { preserveTestEnv } from "../helpers/env"
import { afterAll, afterEach, beforeEach, describe, expect, it } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import type { MessageV2 } from "@/session/message-v2"

/** File name prefixed with `_` so this module loads before other cli tests that static-import config (Global.Path.config is fixed at first xdg import). */
const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-net-precise-"))
process.env.NIKCLI_TEST_HOME = testHome
process.env.XDG_CONFIG_HOME = path.join(testHome, "xdg-config")

preserveTestEnv(["NIKCLI_TEST_HOME", "XDG_CONFIG_HOME"])
await fs.mkdir(path.join(process.env.XDG_CONFIG_HOME, "nikcli"), { recursive: true })

const { Config } = await import("@/config/config")
const { Global } = await import("@nikcli-ai/util/global")
const { ConfigMarkdown } = await import("@/config/markdown")
const { FormatError } = await import("@nikcli-ai/util/cli-error")
const { MCP } = await import("@/mcp")
const { Provider } = await import("@/provider/provider")
const { extractResponseText, parseGitHubRemote } = await import("@/cli/cmd/github")
const { resolveNetworkOptions } = await import("@/cli/network")
const { UI } = await import("@/cli/ui")

const globalConfigPath = path.join(Global.Path.config, "nikcli.json")

async function writeGlobalConfig(content: Record<string, unknown>) {
  await fs.mkdir(Global.Path.config, { recursive: true })
  await Bun.write(globalConfigPath, JSON.stringify(content, null, 2))
}

afterAll(async () => {
  await fs.rm(testHome, { recursive: true, force: true })
})

describe("resolveNetworkOptions — argv flag detection precise", () => {
  let savedArgv: string[]

  beforeEach(async () => {
    savedArgv = [...process.argv]
    delete process.env.PORT
    await writeGlobalConfig({ server: { port: 1111, hostname: "10.0.0.1", mdns: false } })
  })

  afterEach(() => {
    process.argv = savedArgv
    delete process.env.PORT
  })

  it("--hostname in argv prevents config hostname even when config exists", async () => {
    process.argv = ["bun", "cli", "--hostname", "explicit.host"]
    const r = await resolveNetworkOptions({
      port: 0,
      hostname: "explicit.host",
      mdns: false,
      cors: [],
    })
    expect(r.hostname).toBe("explicit.host")
  })

  it("--mdns in argv forces mdns true and 0.0.0.0 when config has no hostname", async () => {
    process.argv = ["bun", "cli", "--mdns"]
    await writeGlobalConfig({})
    const r = await resolveNetworkOptions({
      port: 0,
      hostname: "127.0.0.1",
      mdns: true,
      cors: [],
    })
    expect(r.mdns).toBe(true)
    expect(r.hostname).toBe("0.0.0.0")
  })

  it("PORT env ignored when not a positive integer", async () => {
    process.argv = ["bun", "cli"]
    process.env.PORT = "not-a-port"
    await writeGlobalConfig({})
    const r = await resolveNetworkOptions({
      port: 0,
      hostname: "127.0.0.1",
      mdns: false,
      cors: [],
    })
    expect(r.port).toBe(0)
  })

  it("PORT env zero ignored", async () => {
    process.argv = ["bun", "cli"]
    process.env.PORT = "0"
    await writeGlobalConfig({})
    const r = await resolveNetworkOptions({
      port: 0,
      hostname: "127.0.0.1",
      mdns: false,
      cors: [],
    })
    expect(r.port).toBe(0)
  })

  it("cors merges config first then parsed args (order preserved)", async () => {
    process.argv = ["bun", "cli", "--cors", "https://from-argv"]
    await writeGlobalConfig({ server: { cors: ["https://from-config"] } })
    const r = await resolveNetworkOptions({
      port: 0,
      hostname: "127.0.0.1",
      mdns: false,
      cors: ["https://from-argv"],
    })
    expect(r.cors).toEqual(["https://from-config", "https://from-argv"])
  })
})

describe("FormatError — exact substrings (contract)", () => {
  it("MCP.Failed mentions server name and auth gap", () => {
    const out = FormatError(new MCP.Failed({ name: "srv-a" }))!
    expect(out).toContain("srv-a")
    expect(out).toContain("does not support MCP authentication")
  })

  it("ModelNotFoundError line 1 is exact pattern", () => {
    const out = FormatError(new Provider.ModelNotFoundError({ providerID: "anthropic", modelID: "x" }))!
    expect(out.split("\n")[0]).toBe("Model not found: anthropic/x")
  })

  it("InitError names provider in quotes", () => {
    const out = FormatError(new Provider.InitError({ providerID: "openai" }))!
    expect(out).toBe('Failed to initialize provider "openai". Check credentials and configuration.')
  })

  it("JsonError without message ends with JSON(C) only", () => {
    const out = FormatError(new Config.JsonError({ path: "/abs/nikcli.json" }))!
    expect(out).toBe("Config file at /abs/nikcli.json is not valid JSON(C)")
  })

  it("ConfigDirectoryTypoError includes rename instruction", () => {
    const out = FormatError(
      new Config.ConfigDirectoryTypoError({
        path: "/p",
        dir: "bad",
        suggestion: "good",
      }),
    )!
    expect(out).toContain('Rename the directory to "good"')
    expect(out).toContain("common typo")
  })

  it("InvalidError with only message uses Configuration is invalid prefix", () => {
    const out = FormatError(new Config.InvalidError({ path: "config", message: "one issue" }))!
    expect(out.startsWith("Configuration is invalid: one issue")).toBe(true)
  })

  it("InvalidError with path not config includes at path", () => {
    const out = FormatError(new Config.InvalidError({ path: "/z.json", message: "bad" }))!
    expect(out).toContain("at /z.json")
  })

  it("FrontmatterError returns message only (no wrapper)", () => {
    const msg = "frontmatter: line 2"
    expect(FormatError(new ConfigMarkdown.FrontmatterError({ path: "a.md", message: msg }))).toBe(msg)
  })

  it("UI.CancelledError is exactly empty string", () => {
    expect(FormatError(new UI.CancelledError())).toBe("")
  })
})

const basePart = { id: "p1", sessionID: "ses1", messageID: "msg1" }

describe("parseGitHubRemote — exact owner/repo matrix", () => {
  const cases: { url: string; want: { owner: string; repo: string } | null }[] = [
    { url: "https://github.com/foo/bar", want: { owner: "foo", repo: "bar" } },
    { url: "https://github.com/foo/bar.git", want: { owner: "foo", repo: "bar" } },
    { url: "http://github.com/org/repo-name", want: { owner: "org", repo: "repo-name" } },
    { url: "git@github.com:user123/r2.git", want: { owner: "user123", repo: "r2" } },
    { url: "git@github.com:Acme-Corp/a_b", want: { owner: "Acme-Corp", repo: "a_b" } },
    { url: "ssh://git@github.com/foo/bar", want: { owner: "foo", repo: "bar" } },
    { url: "ssh://git@github.com/foo/bar.git", want: { owner: "foo", repo: "bar" } },
    { url: "github.com:minimal/repo", want: { owner: "minimal", repo: "repo" } },
    { url: "https://github.com/a/bc", want: { owner: "a", repo: "bc" } },
    { url: "https://github.com/x/y.z", want: { owner: "x", repo: "y.z" } },
  ]
  for (const { url, want } of cases) {
    it(`parses ${url}`, () => {
      expect(parseGitHubRemote(url)).toEqual(want)
    })
  }

  const nullCases = [
    "https://github.com/onlyowner",
    "https://github.com/",
    "https://gitlab.com/a/b",
    "git@gitlab.com:a/b.git",
    "",
    "https://github.com/a/b/extra",
  ]
  for (const url of nullCases) {
    it(`returns null for ${JSON.stringify(url)}`, () => {
      expect(parseGitHubRemote(url)).toBeNull()
    })
  }
})

describe("extractResponseText — precise ordering and errors", () => {
  it("last text wins among three text parts", () => {
    const parts = [
      { ...basePart, id: "a", type: "text" as const, text: "a" },
      { ...basePart, id: "b", type: "text" as const, text: "b" },
      { ...basePart, id: "c", type: "text" as const, text: "c" },
    ] as MessageV2.Part[]
    expect(extractResponseText(parts)).toBe("c")
  })

  it("single text returns that text", () => {
    const parts = [{ ...basePart, type: "text" as const, text: "only" }] as MessageV2.Part[]
    expect(extractResponseText(parts)).toBe("only")
  })

  it("throws with exact part-type list for subtask-only", () => {
    const parts = [
      {
        ...basePart,
        type: "subtask" as const,
        prompt: "p",
        description: "d",
        agent: "a",
      },
    ] as MessageV2.Part[]
    expect(() => extractResponseText(parts)).toThrow("Part types found: [subtask]")
  })

  it("throws for file-only parts", () => {
    const parts = [
      {
        ...basePart,
        type: "file" as const,
        mime: "text/plain",
        url: "file:///x",
      },
    ] as MessageV2.Part[]
    expect(() => extractResponseText(parts)).toThrow("Part types found: [file]")
  })

  it("pending tool does not count as completed — throws listing tool", () => {
    const parts = [
      {
        ...basePart,
        type: "tool" as const,
        callID: "c",
        tool: "t",
        state: {
          status: "pending" as const,
          input: {},
          raw: "",
        },
      },
    ] as MessageV2.Part[]
    expect(() => extractResponseText(parts)).toThrow("Part types found: [tool]")
  })

  it("reasoning after text still returns last text", () => {
    const parts = [
      { ...basePart, id: "t", type: "text" as const, text: "out" },
      {
        ...basePart,
        id: "r",
        type: "reasoning" as const,
        text: "think",
        time: { start: 1, end: 2 },
      },
    ] as MessageV2.Part[]
    expect(extractResponseText(parts)).toBe("out")
  })
})
