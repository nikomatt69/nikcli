import { describe, expect, it } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"

// Change 6 (specs/tui-startup-speed.md): when initialize() wipes the cache dir
// on a CACHE_VERSION bump, it must preserve models.json so a post-upgrade cold
// start doesn't lose the models cache and fall back to a blocking network fetch.

describe("initialize() cache-version wipe", () => {
  it("preserves models.json but clears other cache entries, and bumps the version", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-cache-"))
    const prev = process.env.NIKCLI_TEST_HOME
    process.env.NIKCLI_TEST_HOME = home
    try {
      const cacheDir = path.join(home, "cache")
      await fs.mkdir(cacheDir, { recursive: true })
      // Simulate a pre-existing cache from an older version.
      await fs.writeFile(path.join(cacheDir, "version"), "0")
      await fs.writeFile(path.join(cacheDir, "models.json"), '{"keep":true}')
      await fs.writeFile(path.join(cacheDir, "stale.json"), "{}")
      await fs.mkdir(path.join(cacheDir, "stale-dir"), { recursive: true })
      await fs.writeFile(path.join(cacheDir, "stale-dir", "x"), "x")

      const { initialize } = await import("@/global")
      await initialize()

      // models.json is preserved verbatim
      expect(await fs.readFile(path.join(cacheDir, "models.json"), "utf8")).toBe('{"keep":true}')
      // unrelated cache entries are removed
      await expect(fs.access(path.join(cacheDir, "stale.json"))).rejects.toThrow()
      await expect(fs.access(path.join(cacheDir, "stale-dir"))).rejects.toThrow()
      // version is bumped away from the stale value
      const version = await fs.readFile(path.join(cacheDir, "version"), "utf8")
      expect(version).not.toBe("0")
      expect(version.length).toBeGreaterThan(0)
    } finally {
      if (prev === undefined) delete process.env.NIKCLI_TEST_HOME
      else process.env.NIKCLI_TEST_HOME = prev
      await fs.rm(home, { recursive: true, force: true })
    }
  })

  it("is a no-op for cache contents when the version already matches", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-cache-"))
    const prev = process.env.NIKCLI_TEST_HOME
    process.env.NIKCLI_TEST_HOME = home
    try {
      const cacheDir = path.join(home, "cache")
      await fs.mkdir(cacheDir, { recursive: true })

      const { initialize } = await import("@/global")
      // First run establishes the current version.
      await initialize()
      const version = await fs.readFile(path.join(cacheDir, "version"), "utf8")
      // Seed an unrelated entry, then run again with the matching version.
      await fs.writeFile(path.join(cacheDir, "keepme.json"), "{}")
      await initialize()

      expect(await fs.readFile(path.join(cacheDir, "version"), "utf8")).toBe(version)
      // No wipe happened, so the unrelated entry survives.
      expect(await fs.readFile(path.join(cacheDir, "keepme.json"), "utf8")).toBe("{}")
    } finally {
      if (prev === undefined) delete process.env.NIKCLI_TEST_HOME
      else process.env.NIKCLI_TEST_HOME = prev
      await fs.rm(home, { recursive: true, force: true })
    }
  })
})
