import { afterAll, afterEach, describe, expect, it } from "bun:test"
import { Effect } from "effect"
import fs from "fs/promises"
import os from "os"
import path from "path"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-skill-effect-home-"))
process.env.NIKCLI_TEST_HOME = testHome
process.env.NIKCLI_DISABLE_PROJECT_CONFIG = "1"
process.env.NIKCLI_DISABLE_EXTERNAL_SKILLS = "1"
process.env.XDG_DATA_HOME = path.join(testHome, "data")
process.env.XDG_CACHE_HOME = path.join(testHome, "cache")
process.env.XDG_CONFIG_HOME = path.join(testHome, "config")
process.env.XDG_STATE_HOME = path.join(testHome, "state")

const { InstanceScope } = await import("@/effect")
const { Instance } = await import("@/project/instance")
const { Skill } = await import("@/skill")

const projectDirs: string[] = []

async function makeProjectDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-skill-effect-project-"))
  const resolved = await fs.realpath(dir)
  projectDirs.push(resolved)
  return resolved
}

describe("Skill.Service", () => {
  it("creates, loads, resolves, and removes workspace skills through InstanceState context", async () => {
    const directory = await makeProjectDir()
    const result = await Effect.runPromise(
      InstanceScope.with(
        { directory },
        Effect.gen(function* () {
          const skill = yield* Skill.Service
          const created = yield* skill.create({
            name: "effect-test",
            description: "Effect-backed skill",
            category: "test",
            tags: ["effect"],
            content: "# Effect Test\n\nUse Effect services.",
            scope: "workspace",
          })
          const loaded = yield* skill.load("effect-test")
          const resolved = yield* skill.resolve("effect test")
          const removed = yield* skill.remove("effect-test")
          const all = yield* skill.all()

          return { created, loaded, resolved, removed, all }
        }).pipe(Effect.provide(Skill.defaultLayer)),
      ),
    )

    expect(result.created.location).toContain(path.join(".nikcli", "skill", "effect-test", "SKILL.md"))
    expect(result.loaded?.content).toContain("Use Effect services.")
    expect(result.resolved.skill?.name).toBe("effect-test")
    expect(result.removed).toBe(true)
    expect(result.all.map((skill) => skill.name)).not.toContain("effect-test")
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
