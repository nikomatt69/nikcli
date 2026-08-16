import { preserveTestEnv } from "../helpers/env"
import { describe, expect, it } from "bun:test"
import { Effect } from "effect"
import fs from "fs/promises"
import os from "os"
import path from "path"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-permission-surface-home-"))
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

const { InstanceScope } = await import("@/effect")
const { ToolRegistry } = await import("@/tool/registry")
const { Agent } = await import("@/agent/agent")
const { permissionPresetPatch } = await import("@tui/util/permission-presets")

/**
 * Permissions that gate something other than a registry tool. They will never
 * appear in `registry.ids()` and that is correct.
 */
const NON_TOOL_PERMISSIONS = new Set([
  // Guards any file access outside the project root, across every tool.
  "external_directory",
  // Guards the repeated-tool-call loop breaker.
  "doom_loop",
  // Guards which subagents the task tool may spawn.
  "subagents",
  // `list` is a real tool (`tool/ls.ts`, asks the `list` permission) that the
  // registry deliberately does not expose to the model — the prompt builder
  // calls it directly.
  "list",
])

/**
 * Registered only when a flag or client mode is on, so they may be legitimately
 * absent from `registry.ids()` in some builds.
 */
const FLAG_GATED = new Set(["lsp", "browser_control", "computer", "code_mode", "batch", "plan_enter", "plan_exit"])

async function registryIds(): Promise<Set<string>> {
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-permission-surface-project-")))
  const ids = await Effect.runPromise(
    InstanceScope.with(
      { directory },
      Effect.gen(function* () {
        const registry = yield* ToolRegistry.Service
        return yield* registry.ids()
      }).pipe(Effect.provide(ToolRegistry.defaultLayer)),
    ),
  )
  return new Set(ids)
}

/**
 * These lists drift silently: nothing fails when a tool is removed but its
 * permission entry or agent toolset entry stays behind, so the config schema and
 * the preset UI keep advertising capabilities that no longer exist. Both carried
 * stale `rag_*`, `docs_*` and `context_search` entries before this guard existed.
 */
describe("permission and agent surfaces reference real tools", () => {
  it("every preset permission key maps to a tool or a documented non-tool permission", async () => {
    const ids = await registryIds()
    const unknown: string[] = []
    let checked = 0
    for (const preset of ["require_approval", "approve_for_me", "full_access"] as const) {
      for (const key of Object.keys(permissionPresetPatch(preset))) {
        if (key === "*") continue
        checked++
        if (ids.has(key) || NON_TOOL_PERMISSIONS.has(key) || FLAG_GATED.has(key)) continue
        // `question` is registered only for app/cli/desktop clients.
        if (key === "question") continue
        unknown.push(`${preset}:${key}`)
      }
    }
    expect(unknown).toEqual([])
    // Guard the guard: an empty preset would satisfy the assertion above.
    expect(checked).toBeGreaterThan(50)
  })

  it("every subagent toolset entry names a real tool", async () => {
    const ids = await registryIds()
    const unknown: string[] = []
    let checked = 0
    for (const [agent, tools] of Object.entries(Agent.SUBAGENT_TOOLSETS)) {
      for (const tool of tools) {
        checked++
        if (ids.has(tool) || NON_TOOL_PERMISSIONS.has(tool) || FLAG_GATED.has(tool)) continue
        unknown.push(`${agent}:${tool}`)
      }
    }
    expect(unknown).toEqual([])
    expect(checked).toBeGreaterThan(20)
  })
})
