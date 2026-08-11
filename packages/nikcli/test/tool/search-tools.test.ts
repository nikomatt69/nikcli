import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { SearchToolsTool } from "@/tool/search_tools"
import { ToolRegistry } from "@/tool/registry"
import { Instance } from "@/project/instance"
import type { Tool } from "@/tool/tool"
import { makeToolContext, withProjectDirectory } from "../helpers/tool-context"

/** `search_tools` reads the model off `ctx.extra` to mirror the session toolset. */
function contextWithModel(model?: { providerID: string; api: { id: string } }): Tool.Context {
  const { ctx } = makeToolContext()
  return { ...ctx, extra: model ? { model } : undefined }
}

describe("SearchToolsTool", () => {
  let projectDir: string
  let def: Awaited<ReturnType<typeof SearchToolsTool.init>>

  beforeAll(async () => {
    projectDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-search-tools-test-")))
    def = await withProjectDirectory(projectDir, () => SearchToolsTool.init())
  })

  afterAll(async () => {
    await Instance.disposeAll().catch(() => undefined)
    await fs.rm(projectDir, { recursive: true, force: true }).catch(() => {})
  })

  function search(query: string, model?: { providerID: string; api: { id: string } }) {
    return withProjectDirectory(projectDir, () => def.executeAsync({ query }, contextWithModel(model)))
  }

  it("matches a tool by name and returns a summary alongside it", async () => {
    const result = await search("grep")
    expect(result.output).toContain("grep")
    // "- <id>: <summary>" — a bare id list would not tell the model how to use it.
    expect(result.output).toMatch(/- grep: \S/)
    expect(result.metadata.matches).toBeGreaterThan(0)
  })

  it("matches a capability keyword that appears only in descriptions", async () => {
    // No registered tool id contains "git"; before descriptions were searched
    // this query returned nothing, despite being an example in the tool's own docs.
    const result = await search("git")
    expect(result.metadata.matches).toBeGreaterThan(0)
    expect(result.output).not.toContain("No tool matches")
  })

  it("reports a genuine miss without claiming a match", async () => {
    const result = await search("zzzzz-no-such-capability")
    expect(result.metadata.matches).toBe(0)
    expect(result.output).toContain("No tool matches")
    // A miss still lists the catalog so the model can recover in one turn.
    expect(result.output).toContain("Available tools")
    expect(result.metadata.available).toBeGreaterThan(0)
  })

  it("never advertises the internal invalid tool or itself", async () => {
    for (const query of ["invalid", "search", "tool"]) {
      const result = await search(query)
      expect(result.output).not.toMatch(/^- invalid:/m)
      expect(result.output).not.toMatch(/^- search_tools:/m)
    }
  })

  it("ranks a name match above a description-only match", async () => {
    const result = await search("read")
    const lines = result.output.split("\n").filter((line) => line.startsWith("- "))
    const readIndex = lines.findIndex((line) => line.startsWith("- read:"))
    expect(readIndex).toBe(0)
  })

  it("ranks the tool that owns a capability above tools that merely catalog it", async () => {
    // `code_mode` builds its description by embedding the tool catalog, so it
    // contains almost every capability word. Density scoring has to keep the
    // tool that actually takes screenshots ahead of it.
    const result = await search("screenshot")
    const ids = result.output
      .split("\n")
      .filter((line) => line.startsWith("- "))
      .map((line) => line.slice(2, line.indexOf(":")))
    const computer = ids.indexOf("computer")
    const codeMode = ids.indexOf("code_mode")
    // Both tools sit behind experimental flags; assert the ordering only when
    // this build actually registers them.
    if (computer < 0 || codeMode < 0) return
    expect(computer).toBeLessThan(codeMode)
    expect(computer).toBe(0)
  })

  it("reflects the model-conditional toolset instead of the raw registry", async () => {
    // GPT models get apply_patch and lose edit/write; everything else is the
    // other way around. `search_tools` has to follow that same split.
    const gpt = await search("patch", { providerID: "openai", api: { id: "gpt-5" } })
    expect(gpt.output).toMatch(/^- apply_patch:/m)

    const other = await search("edit", { providerID: "anthropic", api: { id: "claude-opus-5" } })
    expect(other.output).toMatch(/^- edit:/m)
    expect(other.output).not.toMatch(/^- apply_patch:/m)
  })
})

describe("ToolRegistry.visible", () => {
  it("keeps an ordinary tool with an empty ruleset", () => {
    expect(ToolRegistry.visible("read", { ruleset: [] })).toBe(true)
  })

  it("drops a tool the session disabled", () => {
    expect(ToolRegistry.visible("read", { disabledTools: { read: true }, ruleset: [] })).toBe(false)
  })

  it("keeps opt-in tools out until they are explicitly switched on", () => {
    expect(ToolRegistry.visible("opentui", { ruleset: [] })).toBe(false)
    expect(ToolRegistry.visible("opentui", { disabledTools: { opentui: false }, ruleset: [] })).toBe(true)
  })

  it("drops a wholly-denied tool but keeps a resource-scoped deny", () => {
    expect(ToolRegistry.visible("bash", { ruleset: [{ permission: "bash", pattern: "*", action: "deny" }] })).toBe(
      false,
    )
    // Denying one path must not hide the tool — it still works elsewhere.
    expect(ToolRegistry.visible("bash", { ruleset: [{ permission: "bash", pattern: "rm *", action: "deny" }] })).toBe(
      true,
    )
  })

  it("follows the tool→permission mapping when a tool delegates", () => {
    // write/multiedit/apply_patch all evaluate against the `edit` permission.
    const ruleset = [{ permission: "edit" as const, pattern: "*", action: "deny" as const }]
    expect(ToolRegistry.visible("write", { ruleset })).toBe(false)
    expect(ToolRegistry.visible("apply_patch", { ruleset })).toBe(false)
    expect(ToolRegistry.visible("read", { ruleset })).toBe(true)
  })
})
