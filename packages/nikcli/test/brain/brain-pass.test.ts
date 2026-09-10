import { preserveTestEnv } from "../helpers/env"
import { removeTestDir } from "../helpers/fs"
import { afterAll, beforeEach, describe, expect, it } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"

/**
 * When the Brain pass counts as having run
 * ([specs/v2/brain-consolidation-pass.md](../../../../specs/v2/brain-consolidation-pass.md)).
 *
 * The pass rewrites two files, and the lock file's mtime is the "last run"
 * timestamp. The rule that makes it a contract rather than a cron job is that
 * the stamp is written only when one of those two files actually changed —
 * otherwise a failed pass would push the next one an interval away.
 *
 * The model half is replaced through `_internalSetExecutor`; what the pass is
 * *allowed* to do while it runs is asserted against the exported ruleset.
 */

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-brain-pass-home-"))
process.env.NIKCLI_TEST_HOME = testHome
process.env.NIKCLI_TEST_MODE = "1"
process.env.NIKCLI_DISABLE_PROJECT_CONFIG = "1"
process.env.XDG_DATA_HOME = path.join(testHome, "data")
process.env.XDG_CACHE_HOME = path.join(testHome, "cache")
process.env.XDG_CONFIG_HOME = path.join(testHome, "config")
process.env.XDG_STATE_HOME = path.join(testHome, "state")

preserveTestEnv([
  "NIKCLI_TEST_HOME",
  "NIKCLI_TEST_MODE",
  "NIKCLI_DISABLE_PROJECT_CONFIG",
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",
  "XDG_CONFIG_HOME",
  "XDG_STATE_HOME",
])
for (const dir of ["data", "cache", "config", "state"]) {
  await fs.mkdir(path.join(testHome, dir), { recursive: true })
}

const projectDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-brain-pass-project-")))
const memoryFile = path.join(projectDir, ".github", "instructions", "memory.instruction.md")
const habitsFile = path.join(projectDir, ".nikcli", "habits.md")

const { Instance } = await import("@/project/instance")
const { Brain, readLastBrainAt } = await import("@/brain")
const { InstanceState } = await import("@/effect")
const { PermissionNext } = await import("@/permission/next")

async function write(file: string, content: string) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, content, "utf8")
}

beforeEach(() => {
  Brain._internalSetExecutor(undefined)
})

afterAll(async () => {
  Brain._internalSetExecutor(undefined)
  await Instance.disposeAll().catch(() => undefined)
  await removeTestDir(testHome)
  await removeTestDir(projectDir)
})

function trigger(mutate: () => Promise<void>) {
  return Instance.provide({
    directory: projectDir,
    fn: async () => {
      Brain._internalSetExecutor(async () => {
        await mutate()
        return "ses_stubbed_brain"
      })
      return Brain.trigger(InstanceState.ambient(), { force: true })
    },
  })
}

describe("Brain pass · when the run is recorded", () => {
  it("does not stamp the lock when neither file changed", async () => {
    await write(memoryFile, "# project memory\n")
    await write(habitsFile, "# user habits\n")
    const before = await readLastBrainAt()

    const result = await trigger(async () => {})

    expect(result.success).toBe(false)
    expect(result.error).toBe("memory file unchanged")
    expect(await readLastBrainAt()).toBe(before)
  })

  it("stamps the lock when project memory changed", async () => {
    await write(memoryFile, "# project memory\n")
    await write(habitsFile, "# user habits\n")
    const before = await readLastBrainAt()

    const result = await trigger(async () => {
      await write(memoryFile, "# project memory\n\n- learned something\n")
    })

    expect(result.success).toBe(true)
    expect(await readLastBrainAt()).toBeGreaterThan(before)
  })

  it("stamps the lock when only habits changed — either output counts", async () => {
    await write(memoryFile, "# project memory\n")
    await write(habitsFile, "# user habits\n")
    const before = await readLastBrainAt()

    const result = await trigger(async () => {
      await write(habitsFile, "# user habits\n\n- prefers bun test\n")
    })

    expect(result.success).toBe(true)
    expect(await readLastBrainAt()).toBeGreaterThan(before)
  })
})

describe("Brain pass · what it is allowed to do", () => {
  const ruleset = [...Brain.SESSION_PERMISSION]
  // `evaluate` takes the rulesets as a rest argument and merges them; a
  // trailing `{}` would be read as another ruleset, not as approvals.
  const action = (permission: string) => PermissionNext.evaluate(permission, "anything", ruleset).action

  it("denies by default", () => {
    expect(ruleset[0]).toEqual({ permission: "*", pattern: "*", action: "deny" })
    expect(action("bash")).toBe("deny")
    expect(action("webfetch")).toBe("deny")
  })

  it("allows exactly the tools a two-file rewrite needs", () => {
    for (const permission of ["read", "edit", "glob", "grep", "list", "tree"]) {
      expect(action(permission)).toBe("allow")
    }
  })

  it("denies the tools that would turn a consolidation pass into an agent", () => {
    for (const permission of ["task", "todowrite", "todoread"]) {
      expect(action(permission)).toBe("deny")
    }
  })
})
