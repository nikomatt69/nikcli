/**
 * Cross-platform invariants for the Windows compatibility fixes.
 *
 * These tests are platform-agnostic: they directly exercise the Node primitives
 * that the source-level fixes rely on, and assert the contract holds for both
 * POSIX and Windows path shapes. Running them on macOS or Linux gives us a
 * concrete signal that the source changes (pathToFileURL, fileURLToPath, XDG
 * fallbacks, shell detection) are using the standard library APIs correctly —
 * the actual Windows runtime is then re-validated by .github/workflows/windows-compat.yml
 * on a real windows-latest runner.
 */
import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "bun:test"
import { fileURLToPath, pathToFileURL } from "node:url"
import { recordBenchmark } from "./benchmarks/runner"

const SRC = path.join(import.meta.dir, "..", "src")
const readSrc = (rel: string) => fs.readFileSync(path.join(SRC, rel), "utf8")

describe("cross-platform file:// URL handling", () => {
  // `pathToFileURL` only round-trips an *absolute native* path: handed a POSIX
  // path on Windows it resolves against the current drive, so `/home/user/foo.txt`
  // comes back as `C:\home\user\foo.txt` and a hardcoded POSIX literal fails for a
  // reason that says nothing about the code under test. The invariant being
  // asserted — the round-trip is lossless — holds on both platforms, so the paths
  // are built natively and the coverage stays rather than being skipped.
  const nativeAbsolute = (...segments: string[]) => path.resolve(path.sep, ...segments)

  it("pathToFileURL roundtrips an absolute path (sanity)", () => {
    const native = nativeAbsolute("home", "user", "foo.txt")
    expect(fileURLToPath(pathToFileURL(native).href)).toBe(native)
  })

  it("pathToFileURL handles spaces and unicode (naive interpolation would break these)", () => {
    const tricky = nativeAbsolute("tmp", "has space", "é", "файл.txt")
    const url = pathToFileURL(tricky).href

    const iterations = 10000
    const start = performance.now()
    for (let i = 0; i < iterations; i++) {
      fileURLToPath(pathToFileURL(tricky).href)
    }
    const roundtripTime = performance.now() - start
    recordBenchmark({
      suite: "platform",
      module: "url",
      scenario: "pathToFileURL roundtrip",
      iterations,
      value: roundtripTime,
      unit: "ms",
    })

    expect(url).toContain("file://")
    expect(url).toContain("%20")
    expect(fileURLToPath(url)).toBe(tricky)
  })

  // The actual Windows drive-letter roundtrip needs a Windows runtime (Bun ignores
  // the `windows: true` option on POSIX). The .github/workflows/windows-compat.yml
  // job re-runs the roundtrip on a real windows-latest runner. Here we encode the
  // contract source-level: every site that constructs a `file://` URL from a
  // filesystem path must go through pathToFileURL — never through `file://${path}`.
  const fileUrlSites = ["session/prompt-parts.ts", "acp/content.ts", "cli/cmd/run.ts"] as const

  for (const rel of fileUrlSites) {
    it(`${rel} uses pathToFileURL and does not naively concat file:// + a filesystem path`, () => {
      const src = readSrc(rel)
      expect(src).toContain("pathToFileURL")
      // The naive shapes we removed — match the exact patterns the fix replaced.
      const naivePatterns = ["`file://${filepath}`", "`file://${resolvedPath}`", "`file://${path}`"]
      for (const naive of naivePatterns) {
        expect(src).not.toContain(naive)
      }
    })
  }
})

describe("cross-platform path separator handling (used by acp/agent parseUri basename)", () => {
  it("basename extraction works for both / and \\ separators", () => {
    const splitBoth = (p: string) => p.split(/[\\/]/).pop()
    expect(splitBoth("/foo/bar/baz.txt")).toBe("baz.txt")
    expect(splitBoth("C:\\foo\\bar\\baz.txt")).toBe("baz.txt")
    expect(splitBoth("relative\\thing.md")).toBe("thing.md")
    expect(splitBoth("just-a-name")).toBe("just-a-name")
  })
})

describe("Global.Path Windows fallback logic (used by src/global/index.ts)", () => {
  // Replicates the platform branch the source uses, so we can prove the chosen
  // fallback strings would resolve to Windows-shaped paths even on a POSIX host.
  function pickFallback(platform: NodeJS.Platform, home: string, env: Partial<NodeJS.ProcessEnv>) {
    const isWindows = platform === "win32"
    const winLocalAppData = env.LOCALAPPDATA || path.win32.join(home, "AppData", "Local")
    const winRoamingAppData = env.APPDATA || path.win32.join(home, "AppData", "Roaming")
    return {
      data: isWindows ? winLocalAppData : path.posix.join(home, ".local", "share"),
      cache: isWindows ? path.win32.join(winLocalAppData, "Cache") : path.posix.join(home, ".cache"),
      config: isWindows ? winRoamingAppData : path.posix.join(home, ".config"),
      state: isWindows ? path.win32.join(winLocalAppData, "State") : path.posix.join(home, ".local", "state"),
    }
  }

  it("falls back to LOCALAPPDATA / APPDATA when env vars are set on Windows", () => {
    const result = pickFallback("win32", "C:\\Users\\nik", {
      LOCALAPPDATA: "C:\\Users\\nik\\AppData\\Local",
      APPDATA: "C:\\Users\\nik\\AppData\\Roaming",
    })
    expect(result.data).toBe("C:\\Users\\nik\\AppData\\Local")
    expect(result.config).toBe("C:\\Users\\nik\\AppData\\Roaming")
    expect(result.cache.endsWith("Cache")).toBe(true)
    expect(result.state.endsWith("State")).toBe(true)
    // Critical: must NOT leak POSIX dotfile layout
    expect(result.data).not.toContain("/.local/share/")
    expect(result.cache).not.toContain("/.cache/")
    expect(result.config).not.toContain("/.config/")
  })

  it("synthesizes a Windows AppData path when the env vars are missing", () => {
    const result = pickFallback("win32", "C:\\Users\\nik", {})
    expect(result.data).toBe("C:\\Users\\nik\\AppData\\Local")
    expect(result.config).toBe("C:\\Users\\nik\\AppData\\Roaming")
  })

  it("keeps POSIX dotfile layout on macOS and Linux", () => {
    const linux = pickFallback("linux", "/home/nik", {})
    expect(linux.data).toBe("/home/nik/.local/share")
    expect(linux.cache).toBe("/home/nik/.cache")
    expect(linux.config).toBe("/home/nik/.config")

    const mac = pickFallback("darwin", "/Users/nik", {})
    expect(mac.data).toBe("/Users/nik/.local/share")
  })
})

describe("Shell.killTree branch coverage (src/shell/shell.ts)", () => {
  it("Windows branch must terminate before reaching SIGKILL fallback", () => {
    // The implementation has two distinct branches:
    //   if (process.platform === 'win32') { spawn('taskkill', ...); return }
    //   try { process.kill(-pid, 'SIGTERM'); ... } catch { proc.kill('SIGKILL') }
    // Here we re-encode that contract as an assertion so a future regression
    // (e.g. removing the early return) would fail this test on any platform.
    // SAFETY: `readFileSync` with a "utf8" encoding returns a string; the
    // untyped `require` is what loses that.
    const source = require("node:fs").readFileSync(
      require("node:path").join(__dirname, "../src/shell/shell.ts"),
      "utf8",
    ) as string
    const winBranch = source.indexOf('if (process.platform === "win32")')
    expect(winBranch).toBeGreaterThan(-1)
    const sigkillFallback = source.indexOf('"SIGKILL"')
    expect(sigkillFallback).toBeGreaterThan(-1)
    // The win32 branch must come BEFORE the SIGKILL site, and there must be a
    // `return` between them so Windows never reaches process.kill(SIGKILL).
    expect(winBranch).toBeLessThan(sigkillFallback)
    const between = source.slice(winBranch, sigkillFallback)
    expect(between).toContain("return")
    expect(between).toContain("taskkill")
  })
})
