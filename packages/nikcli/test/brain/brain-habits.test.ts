import { preserveTestEnv } from "../helpers/env"
import { afterAll, describe, expect, it } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-brain-habits-home-"))
process.env.NIKCLI_TEST_HOME = testHome
process.env.NIKCLI_DISABLE_PROJECT_CONFIG = "1"
process.env.NIKCLI_DISABLE_MODELS_FETCH = "1"
process.env.XDG_DATA_HOME = path.join(testHome, "data")
process.env.XDG_CACHE_HOME = path.join(testHome, "cache")
process.env.XDG_CONFIG_HOME = path.join(testHome, "config")
process.env.XDG_STATE_HOME = path.join(testHome, "state")

preserveTestEnv([
  "NIKCLI_TEST_HOME",
  "NIKCLI_DISABLE_PROJECT_CONFIG",
  "NIKCLI_DISABLE_MODELS_FETCH",
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",
  "XDG_CONFIG_HOME",
  "XDG_STATE_HOME",
])

const { Brain } = await import("../../src/brain")

const MEMORY = "/tmp/project/.github/instructions/memory.instruction.md"
const HABITS = "/tmp/project/.nikcli/habits.md"

describe("Brain habits prompt", () => {
  it("asks for both files and keeps their purposes apart", () => {
    const prompt = Brain.buildBrainPrompt(MEMORY, "(transcripts)", "existing project memory", {
      path: HABITS,
      content: "- prefers small commits",
    })

    expect(prompt).toContain(MEMORY)
    expect(prompt).toContain(HABITS)
    expect(prompt).toContain("Phase 3b")
    expect(prompt).toContain("Keep them strictly separate")
    expect(prompt).toContain("existing project memory")
    expect(prompt).toContain("- prefers small commits")
  })

  it("guards the habits file against one-off noise and sensitive data", () => {
    const prompt = Brain.buildBrainPrompt(MEMORY, "(transcripts)", "", { path: HABITS, content: "" })

    expect(prompt).toContain("Only patterns seen more than once")
    expect(prompt).toContain("Never record secrets")
    expect(prompt).toContain("leave the file untouched")
  })

  it("degrades to the original project-only pass when no habits file is given", () => {
    const prompt = Brain.buildBrainPrompt(MEMORY, "(transcripts)", "")

    expect(prompt).toContain(MEMORY)
    expect(prompt).not.toContain("Phase 3b")
    expect(prompt).not.toContain("habits")
  })
})

afterAll(async () => {
  await fs.rm(testHome, { recursive: true, force: true })
})
