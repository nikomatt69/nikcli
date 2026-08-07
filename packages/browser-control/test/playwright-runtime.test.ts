import { describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { findPlaywrightEntry, PlaywrightUnavailableError, resolveChromium } from "../src/playwright-runtime"

/**
 * Guards the one property that matters here: Playwright is found *at runtime*,
 * from a real directory, rather than inlined by the bundler. The compiled-binary
 * half of that cannot be asserted from a test run — it needs an actual
 * `bun build --compile` — so what these cover is that discovery works and that
 * an absent installation produces something a user can act on.
 */
describe("playwright runtime resolution", () => {
  test("finds an installation and returns a path that exists", () => {
    const entry = findPlaywrightEntry()
    expect(entry).not.toBeNull()
    expect(existsSync(entry!)).toBe(true)
    expect(entry!).toContain("playwright")
  })

  test("the entry is an absolute path, not a bare specifier", () => {
    // A bare "playwright" would mean the bundler gets to resolve it, which is
    // exactly the failure this module exists to prevent.
    const entry = findPlaywrightEntry()!
    expect(entry.startsWith("/") || /^[A-Za-z]:[\\/]/.test(entry)).toBe(true)
  })

  test("resolves a Chromium launcher", async () => {
    const chromium = await resolveChromium()
    expect(typeof chromium.launch).toBe("function")
  }, 30_000)

  test("caches the launcher across calls", async () => {
    const [a, b] = await Promise.all([resolveChromium(), resolveChromium()])
    expect(a).toBe(b)
  }, 30_000)

  /**
   * The regression this guards against is invisible to every other test: a
   * literal `import("playwright")` behaves identically from source and only
   * breaks once the code is compiled into a binary and shipped. Asserting on
   * the source is the cheapest way to catch it before a release does.
   */
  test("no source file imports playwright as a value", async () => {
    const offenders: string[] = []
    for await (const file of new Bun.Glob("**/*.ts").scan({
      cwd: new URL("../src", import.meta.url).pathname,
      absolute: true,
    })) {
      const source = await Bun.file(file).text()
      // `import type { … } from "playwright"` is erased at build time and fine.
      for (const line of source.split("\n")) {
        const isValueImport =
          /^\s*import\s+(?!type\b)[^;]*from\s+["']playwright["']/.test(line) ||
          /\bimport\(\s*["']playwright(-core)?["']\s*\)/.test(line)
        if (isValueImport) offenders.push(`${file}: ${line.trim()}`)
      }
    }
    expect(offenders).toEqual([])
  })

  test("PlaywrightUnavailableError says what to do about it", () => {
    const error = new PlaywrightUnavailableError("no installation found on this machine")
    expect(error.name).toBe("PlaywrightUnavailableError")
    expect(error.message).toContain("NIKCLI_PLAYWRIGHT_PATH")
    expect(error.message).toContain("no installation found on this machine")
  })
})
