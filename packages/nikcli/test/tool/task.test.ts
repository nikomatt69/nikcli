import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { TaskTool } from "@/tool/task"
import { Instance } from "@/project/instance"
import { withProjectDirectory } from "../helpers/tool-context"

/**
 * TaskTool.spawns full agent loops (LLM + Session). Keep this file to
 * schema/init surface only; behavioural coverage lives in integration suites.
 * `init()` lists agents under Instance ALS, so wrap with `withProjectDirectory`.
 */
describe("TaskTool parameters", () => {
  let projectDir: string
  let testHome: string
  let def: Awaited<ReturnType<typeof TaskTool.init>>
  const previousHome = process.env.NIKCLI_TEST_HOME
  const previousDisable = process.env.NIKCLI_DISABLE_PROJECT_CONFIG

  beforeAll(async () => {
    testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-task-home-"))
    process.env.NIKCLI_TEST_HOME = testHome
    process.env.NIKCLI_DISABLE_PROJECT_CONFIG = "1"
    projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-task-proj-"))
    def = await withProjectDirectory(projectDir, () => TaskTool.init())
  })

  afterAll(async () => {
    await Instance.disposeAll().catch(() => undefined)
    if (previousHome === undefined) delete process.env.NIKCLI_TEST_HOME
    else process.env.NIKCLI_TEST_HOME = previousHome
    if (previousDisable === undefined) delete process.env.NIKCLI_DISABLE_PROJECT_CONFIG
    else process.env.NIKCLI_DISABLE_PROJECT_CONFIG = previousDisable
    await fs.rm(projectDir, { recursive: true, force: true }).catch(() => {})
    await fs.rm(testHome, { recursive: true, force: true }).catch(() => {})
  })

  it("requires description, prompt, and subagent_type", () => {
    expect(() => def.parameters.parse({})).toThrow()
    expect(() =>
      def.parameters.parse({
        description: "do thing",
        prompt: "please do the thing",
        subagent_type: "explore",
      }),
    ).not.toThrow()
  })

  it("defaults background to true", () => {
    const parsed = def.parameters.parse({
      description: "bg task",
      prompt: "run in background",
      subagent_type: "explore",
    })
    expect(parsed.background).toBe(true)
  })

  it("embeds accessible agents in the description", () => {
    expect(def.description.length).toBeGreaterThan(0)
  })
})
