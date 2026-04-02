import { describe, expect, it } from "bun:test"
import { ApplyPatchTool } from "../../src/tool/apply_patch"
import { BashTool } from "../../src/tool/bash"
import { EditTool } from "../../src/tool/edit"
import { GlobTool } from "../../src/tool/glob"
import { GrepTool } from "../../src/tool/grep"
import { ReadTool } from "../../src/tool/read"
import { TreeTool } from "../../src/tool/tree"
import { WriteTool } from "../../src/tool/write"
import type { Tool } from "../../src/tool/tool"

const TOOL_INFOS: Tool.Info[] = [BashTool, ReadTool, TreeTool, GlobTool, GrepTool, EditTool, WriteTool, ApplyPatchTool]

const cache = new Map<string, Tool.Info[]>()

function usePatch(modelID: string) {
  return modelID.includes("gpt-") && !modelID.includes("oss") && !modelID.includes("gpt-4")
}

function filterTools(modelID: string) {
  return TOOL_INFOS.filter((tool) => {
    if (tool.id === "apply_patch") return usePatch(modelID)
    if (tool.id === "edit" || tool.id === "write") return !usePatch(modelID)
    return true
  })
}

function cachedTools(modelID: string) {
  const cached = cache.get(modelID)
  if (cached) return cached
  const next = filterTools(modelID)
  cache.set(modelID, next)
  return next
}

function measureSync(name: string, iterations: number, fn: () => void) {
  const start = performance.now()
  for (let i = 0; i < iterations; i++) fn()
  const elapsed = performance.now() - start
  const opsPerSecond = Math.round(iterations / (elapsed / 1000))
  console.log(`\n📊 ${name}:`)
  console.log(`   Iterations: ${iterations.toLocaleString()}`)
  console.log(`   Total time: ${elapsed.toFixed(2)}ms`)
  console.log(`   Throughput: ${opsPerSecond.toLocaleString()} ops/sec`)
  return elapsed
}

async function measureAsync(name: string, iterations: number, fn: () => Promise<void>) {
  const start = performance.now()
  for (let i = 0; i < iterations; i++) {
    await fn()
  }
  const elapsed = performance.now() - start
  const opsPerSecond = Math.round(iterations / (elapsed / 1000))
  console.log(`\n📊 ${name}:`)
  console.log(`   Iterations: ${iterations.toLocaleString()}`)
  console.log(`   Total time: ${elapsed.toFixed(2)}ms`)
  console.log(`   Throughput: ${opsPerSecond.toLocaleString()} ops/sec`)
  return elapsed
}

describe("Tool Registry Benchmarks", () => {
  it("benchmarks model-based tool filtering", () => {
    const claudeTools = filterTools("claude-3-5-sonnet-20241022")
    const gptTools = filterTools("gpt-5-mini")

    const elapsed = measureSync("tool filtering by model", 10000, () => {
      filterTools("claude-3-5-sonnet-20241022")
      filterTools("gpt-5-mini")
    })

    expect(claudeTools.some((tool) => tool.id === "edit")).toBe(true)
    expect(claudeTools.some((tool) => tool.id === "apply_patch")).toBe(false)
    expect(gptTools.some((tool) => tool.id === "apply_patch")).toBe(true)
    expect(gptTools.some((tool) => tool.id === "edit")).toBe(false)
    expect(elapsed).toBeGreaterThanOrEqual(0)
  })

  it("benchmarks cached retrieval of filtered tools", () => {
    cache.clear()
    const cold = cachedTools("claude-3-5-sonnet-20241022")
    const warmElapsed = measureSync("cached tool selection", 20000, () => {
      const selected = cachedTools("claude-3-5-sonnet-20241022")
      expect(selected.length).toBe(cold.length)
    })

    expect(cache.size).toBe(1)
    expect(warmElapsed).toBeGreaterThanOrEqual(0)
  })

  it("benchmarks tool initialization for a filtered set", async () => {
    const selected = cachedTools("claude-3-5-sonnet-20241022")

    await measureAsync("tool.init() selected inventory", 40, async () => {
      const initialized = await Promise.all(selected.map((tool) => tool.init()))
      expect(initialized.length).toBe(selected.length)
      expect(initialized.every((tool) => tool.description.length > 0)).toBe(true)
    })
  })

  it("benchmarks metadata extraction from initialized tools", async () => {
    const initialized = await Promise.all(cachedTools("claude-3-5-sonnet-20241022").map((tool) => tool.init()))
    const elapsed = measureSync("tool metadata extraction", 10000, () => {
      const summary = initialized.map((tool) => ({
        descriptionLength: tool.description.length,
        hasValidation: typeof tool.formatValidationError === "function",
      }))
      expect(summary.length).toBe(initialized.length)
    })

    expect(elapsed).toBeGreaterThanOrEqual(0)
  })
})
