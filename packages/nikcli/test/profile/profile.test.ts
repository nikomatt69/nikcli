import { preserveTestEnv } from "../helpers/env"
import { afterAll, beforeEach, describe, expect, it } from "bun:test"
import { Effect } from "effect"
import fs from "fs/promises"
import os from "os"
import path from "path"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-profile-home-"))
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

const { Profile } = await import("@/profile")

// `Profile` arrives through a dynamic import (the env has to be set first), so
// its namespace is not usable as a type here — hence the untyped requirement.
function run<A, E>(effect: Effect.Effect<A, E, any>) {
  // SAFETY: `Profile.defaultLayer` provides every requirement the effect
  // declares; the comment above explains why `R` cannot be named here.
  return Effect.runPromise(effect.pipe(Effect.provide(Profile.defaultLayer)) as Effect.Effect<A, E>)
}

const worktrees: string[] = []

async function makeWorktree() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-profile-project-"))
  const resolved = await fs.realpath(dir)
  worktrees.push(resolved)
  return resolved
}

async function writeHabits(worktree: string, content: string) {
  const target = Profile.habitsFile(worktree)
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.writeFile(target, content, "utf8")
  return target
}

beforeEach(async () => {
  // Each test starts from "no profile at all"; the service caches reads, so the
  // directory has to go before the cache would hand back a stale hit.
  await fs.rm(Profile.directory(), { recursive: true, force: true })
  await run(
    Effect.gen(function* () {
      const profile = yield* Profile.Service
      yield* profile.clear()
    }),
  )
})

describe("Profile storage", () => {
  it("round-trips a saved profile", async () => {
    const saved = await run(
      Effect.gen(function* () {
        const profile = yield* Profile.Service
        yield* profile.save({ name: "Nik", role: "engineer", stack: ["bun", "solid"] })
        return yield* profile.get()
      }),
    )

    expect(saved?.name).toBe("Nik")
    expect(saved?.stack).toEqual(["bun", "solid"])
    expect(saved?.version).toBe(Profile.VERSION)
    expect(await Bun.file(path.join(Profile.directory(), "local.json")).exists()).toBe(true)
  })

  it("merges on patch and drops fields that are blanked out", async () => {
    const result = await run(
      Effect.gen(function* () {
        const profile = yield* Profile.Service
        yield* profile.save({ name: "Nik", role: "engineer" })
        yield* profile.patch({ stack: ["bun"] })
        yield* profile.patch({ role: "" })
        return yield* profile.get()
      }),
    )

    expect(result?.name).toBe("Nik")
    expect(result?.stack).toEqual(["bun"])
    expect(result?.role).toBeUndefined()
  })

  it("ignores a malformed profile file instead of failing the read", async () => {
    await fs.mkdir(Profile.directory(), { recursive: true })
    await fs.writeFile(path.join(Profile.directory(), "local.json"), "{ not json", "utf8")

    const result = await run(
      Effect.gen(function* () {
        const profile = yield* Profile.Service
        return yield* profile.get()
      }),
    )
    expect(result).toBeUndefined()
  })
})

describe("Profile.render", () => {
  it("renders nothing when no field carries signal", () => {
    expect(Profile.render({ version: 1, key: "local", updatedAt: 0 })).toEqual([])
  })

  it("includes declared fields and preferences", () => {
    const [block] = Profile.render({
      version: 1,
      key: "local",
      updatedAt: 0,
      name: "Nik",
      about: "builds CLIs",
      skills: ["effect"],
      tools: { preferred: ["monitor"], avoid: ["bash"] },
      conventions: ["always bun, never npm"],
      communication: { verbosity: "concise", explain: false, language: "Italian" },
    })

    expect(block).toContain("<user_profile>")
    expect(block).toContain("Name: Nik")
    expect(block).toContain("Preferred skills: effect")
    expect(block).toContain("Preferred tools: monitor")
    expect(block).toContain("Tools to avoid: bash")
    expect(block).toContain("- always bun, never npm")
    expect(block).toContain("keep answers short")
    expect(block).toContain("Italian")
    expect(block).toContain("</user_profile>")
  })

  it("never lets the profile outrank project instructions", () => {
    const [block] = Profile.render({ version: 1, key: "local", updatedAt: 0, name: "Nik" })
    expect(block).toContain("never overrides project instructions")
  })
})

describe("Profile.renderHabits", () => {
  it("renders nothing for an empty or header-only file", () => {
    expect(Profile.renderHabits("")).toEqual([])
    expect(Profile.renderHabits("# User habits\n\n")).toEqual([])
  })

  it("keeps the body and marks it as inferred", () => {
    const [block] = Profile.renderHabits("# User habits\n\n## Workflow\n- runs typecheck through monitor\n")
    expect(block).toContain("<user_habits>")
    expect(block).not.toContain("# User habits")
    expect(block).toContain("- runs typecheck through monitor")
    expect(block).toContain("the user is right")
  })

  it("truncates a runaway file", () => {
    const [block] = Profile.renderHabits(`- ${"x".repeat(20_000)}`)
    expect(block!.length).toBeLessThan(5_000)
    expect(block).toContain("(truncated)")
  })
})

describe("Profile reminder", () => {
  it("returns nothing when there is neither a profile nor habits", async () => {
    const worktree = await makeWorktree()
    const parts = await run(
      Effect.gen(function* () {
        const profile = yield* Profile.Service
        return yield* profile.reminder(worktree)
      }),
    )
    expect(parts).toEqual([])
  })

  it("combines the declared profile with the project's learned habits", async () => {
    const worktree = await makeWorktree()
    await writeHabits(worktree, "# User habits\n\n- prefers small commits\n")

    const parts = await run(
      Effect.gen(function* () {
        const profile = yield* Profile.Service
        yield* profile.save({ name: "Nik" })
        return yield* profile.reminder(worktree)
      }),
    )

    expect(parts.length).toBe(2)
    expect(parts[0]).toContain("Name: Nik")
    expect(parts[1]).toContain("prefers small commits")
  })

  it("drops the learned half when the user opted out, keeping the declared half", async () => {
    const worktree = await makeWorktree()
    await writeHabits(worktree, "- prefers small commits\n")

    const parts = await run(
      Effect.gen(function* () {
        const profile = yield* Profile.Service
        yield* profile.save({ name: "Nik", habits: false })
        return yield* profile.reminder(worktree)
      }),
    )

    expect(parts.length).toBe(1)
    expect(parts[0]).toContain("Name: Nik")
  })

  it("still surfaces habits when no profile was ever filled in", async () => {
    const worktree = await makeWorktree()
    await writeHabits(worktree, "- prefers small commits\n")

    const parts = await run(
      Effect.gen(function* () {
        const profile = yield* Profile.Service
        return yield* profile.reminder(worktree)
      }),
    )

    expect(parts.length).toBe(1)
    expect(parts[0]).toContain("prefers small commits")
  })

  it("clears habits from disk", async () => {
    const worktree = await makeWorktree()
    const target = await writeHabits(worktree, "- prefers small commits\n")

    const removed = await run(
      Effect.gen(function* () {
        const profile = yield* Profile.Service
        return yield* profile.clearHabits(worktree)
      }),
    )

    expect(removed).toBe(true)
    expect(await Bun.file(target).exists()).toBe(false)
  })

  it("puts the habits file inside the project's .nikcli directory", async () => {
    const worktree = await makeWorktree()
    expect(Profile.habitsFile(worktree)).toBe(path.join(worktree, ".nikcli", "habits.md"))
  })
})

afterAll(async () => {
  await Promise.all(worktrees.map((dir) => fs.rm(dir, { recursive: true, force: true })))
  await fs.rm(testHome, { recursive: true, force: true })
})
