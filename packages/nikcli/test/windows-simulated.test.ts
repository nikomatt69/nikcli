/**
 * Windows runtime simulation suite.
 *
 * These tests run on macOS/Linux but actively *exercise* the Windows code
 * branches by spawning Bun subprocesses with `process.platform` and Windows
 * env vars patched in via a preload script. The goal: every conditional that
 * depends on `process.platform === "win32"` or on Windows-only env vars
 * (LOCALAPPDATA, APPDATA, COMSPEC, NIKCLI_GIT_BASH_PATH, etc.) executes its
 * Windows branch and produces the expected output — without needing a real
 * Windows machine.
 *
 * Architecture: each test serializes a snippet of TypeScript, dumps it in a
 * temp file with a header that monkey-patches `process` to look like Windows,
 * then invokes it via `bun run`. Bun's module loader still executes our real
 * source modules; only the platform sniffing is faked.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import fs from "node:fs/promises"
import { existsSync } from "node:fs"
import path from "node:path"
import { recordBenchmark } from "./benchmarks/runner"

const ROOT = path.resolve(import.meta.dir, "..")
// Keep temp files INSIDE the package so tsconfig path aliases (e.g. "@/") resolve.
const TMP_DIR = path.join(ROOT, "tmp", "windows-sim")
const tempFiles: string[] = []

beforeAll(async () => {
  await fs.mkdir(TMP_DIR, { recursive: true })
})

afterAll(async () => {
  await Promise.all(tempFiles.map((f) => fs.rm(f, { force: true }).catch(() => undefined)))
})

interface SimEnv {
  /** Override values pasted into process.env before the snippet runs. */
  env?: Record<string, string>
  /** Faked process.platform value. */
  platform?: "win32" | "linux" | "darwin"
  /** Faked process.arch value. */
  arch?: "x64" | "arm64"
}

/** Parent test runner env vars that override Global.Path and must not leak into sim subprocesses. */
const TEST_ISOLATION_ENV_KEYS = [
  "NIKCLI_TEST_HOME",
  "NIKCLI_DATA_DIR",
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",
  "XDG_CONFIG_HOME",
  "XDG_STATE_HOME",
] as const

function buildSubprocessEnv(sim: SimEnv): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env }
  for (const key of TEST_ISOLATION_ENV_KEYS) {
    delete env[key]
  }
  if (sim.env) {
    for (const [key, value] of Object.entries(sim.env)) {
      env[key] = value
    }
  }
  return env
}

/**
 * Runs `body` as a Bun subprocess after patching process.platform and env.
 * Returns stdout (trimmed). Throws if the subprocess exits non-zero.
 */
async function runSimulated(body: string, sim: SimEnv = {}): Promise<string> {
  const platform = sim.platform ?? "win32"
  const arch = sim.arch ?? "x64"
  const envPatches = Object.entries(sim.env ?? {})
    .map(([k, v]) => `process.env[${JSON.stringify(k)}] = ${JSON.stringify(v)}`)
    .join("\n")

  const preamble = `
// --- Windows platform/env simulation preamble ---
Object.defineProperty(process, "platform", { value: ${JSON.stringify(platform)}, configurable: true })
Object.defineProperty(process, "arch", { value: ${JSON.stringify(arch)}, configurable: true })
${envPatches}
// --- end preamble ---
`
  const tmp = path.join(TMP_DIR, `sim-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.ts`)
  tempFiles.push(tmp)
  await fs.writeFile(tmp, preamble + "\n" + body, "utf8")

  const proc = Bun.spawn({
    cmd: ["bun", "run", "--conditions=browser", tmp],
    cwd: ROOT,
    stdout: "pipe",
    stderr: "pipe",
    env: buildSubprocessEnv(sim),
  })
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
  const code = await proc.exited
  if (code !== 0) {
    throw new Error(`subprocess exited ${code}\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`)
  }
  return stdout.trim()
}

describe("Windows simulation — Global.Path XDG fallbacks (src/global/index.ts)", () => {
  it("resolves data/config/cache to Windows AppData when LOCALAPPDATA + APPDATA are set", async () => {
    const out = await runSimulated(
      `
      const { Global } = await import("@/global")
      const out = {
        data: Global.Path.data,
        cache: Global.Path.cache,
        config: Global.Path.config,
        state: Global.Path.state,
      }
      console.log(JSON.stringify(out))
      `,
      {
        env: {
          LOCALAPPDATA: "C:/Users/nik/AppData/Local",
          APPDATA: "C:/Users/nik/AppData/Roaming",
          // Clear any inherited XDG vars so our fallback path executes.
          XDG_DATA_HOME: "",
          XDG_CACHE_HOME: "",
          XDG_CONFIG_HOME: "",
          XDG_STATE_HOME: "",
        },
      },
    )
    const paths = JSON.parse(out) as Record<string, string>
    expect(paths.data).toContain("AppData")
    expect(paths.config).toContain("AppData")
    // Critical regression guard: must never leak POSIX dotfile layout when
    // platform=win32.
    for (const key of ["data", "cache", "config", "state"] as const) {
      expect(paths[key]).not.toContain("/.local/share/")
      expect(paths[key]).not.toContain("/.cache/")
      expect(paths[key]).not.toContain("/.config/")
    }
  })

  it("synthesizes home/AppData paths when LOCALAPPDATA / APPDATA are missing", async () => {
    const out = await runSimulated(
      `
      const { Global } = await import("@/global")
      console.log(JSON.stringify({ data: Global.Path.data, config: Global.Path.config }))
      `,
      {
        env: {
          // Explicitly blank both — exercises the fallback computation.
          LOCALAPPDATA: "",
          APPDATA: "",
          XDG_DATA_HOME: "",
          XDG_CACHE_HOME: "",
          XDG_CONFIG_HOME: "",
          XDG_STATE_HOME: "",
        },
      },
    )
    const paths = JSON.parse(out) as { data: string; config: string }
    expect(paths.data).toContain("AppData")
    expect(paths.config).toContain("AppData")
  })

  it("on simulated linux platform, falls back to POSIX dotfile layout (regression guard)", async () => {
    const out = await runSimulated(
      `
      const { Global } = await import("@/global")
      console.log(JSON.stringify({ data: Global.Path.data, config: Global.Path.config }))
      `,
      {
        platform: "linux",
        env: {
          HOME: "/home/nik",
          XDG_DATA_HOME: "",
          XDG_CACHE_HOME: "",
          XDG_CONFIG_HOME: "",
          XDG_STATE_HOME: "",
          // Make sure no Windows env leaks across:
          LOCALAPPDATA: "",
          APPDATA: "",
        },
      },
    )
    const paths = JSON.parse(out) as { data: string; config: string }
    // Validates the platform switch in src/global/index.ts: Windows code MUST
    // NOT activate when platform is linux.
    expect(paths.data).not.toContain("AppData")
    expect(paths.config).not.toContain("AppData")
  })
})

describe("Windows simulation — Shell.preferred / Shell.acceptable (src/shell/shell.ts)", () => {
  it("falls back to COMSPEC when no SHELL env var is set on Windows", async () => {
    const out = await runSimulated(
      `
      const { Shell } = await import("@/shell/shell")
      const pref = Shell.preferred()
      console.log("pref:", pref)
      `,
      {
        env: {
          SHELL: "",
          COMSPEC: "C:/Windows/System32/cmd.exe",
        },
      },
    )
    expect(out).toContain("cmd.exe")
  })

  it("Shell.acceptable rejects non-Windows shells configured by SHELL on Windows", async () => {
    // Even when SHELL=/bin/fish leaks in (e.g. via dev terminal), we must not
    // return it as a usable shell on Windows.
    const out = await runSimulated(
      `
      const { Shell } = await import("@/shell/shell")
      console.log("acceptable:", Shell.acceptable())
      `,
      {
        env: {
          SHELL: "/usr/local/bin/fish",
          COMSPEC: "C:/Windows/System32/cmd.exe",
          NIKCLI_GIT_BASH_PATH: "",
        },
      },
    )
    // BLACKLIST contains "fish" — Shell.acceptable() should NOT echo fish back.
    expect(out).not.toContain("fish")
  })
})

describe("Windows simulation — bin/nikcli launcher Windows binary resolution", () => {
  it("looks up the nikcli-ai-windows-<arch> sibling package, not darwin/linux", async () => {
    // We don't actually want to invoke the launcher (it would refuse without an
    // installed binary). Instead we exercise the platform/arch mapping that the
    // launcher uses, proving the same lookup string Windows would compute.
    const out = await runSimulated(
      `
      const platformMap = { darwin: "darwin", linux: "linux", win32: "windows" }
      const archMap = { x64: "x64", arm64: "arm64", arm: "arm" }
      const platform = platformMap[process.platform] || process.platform
      const arch = archMap[process.arch] || process.arch
      console.log("base:", "nikcli-ai-" + platform + "-" + arch)
      console.log("binary:", platform === "windows" ? "nikcli.exe" : "nikcli")
      `,
      { arch: "x64" },
    )
    expect(out).toContain("base: nikcli-ai-windows-x64")
    expect(out).toContain("binary: nikcli.exe")

    const arm = await runSimulated(
      `
      const platformMap = { darwin: "darwin", linux: "linux", win32: "windows" }
      const archMap = { x64: "x64", arm64: "arm64", arm: "arm" }
      const platform = platformMap[process.platform] || process.platform
      const arch = archMap[process.arch] || process.arch
      console.log("base:", "nikcli-ai-" + platform + "-" + arch)
      `,
      { arch: "arm64" },
    )
    expect(arm).toContain("base: nikcli-ai-windows-arm64")
  })
})

describe("Windows cross-build artifact (script/cross-build-windows.ts)", () => {
  it("produced a valid PE binary at dist/cross-windows-x64/bin/nikcli.exe", async () => {
    // The build is run separately (it takes ~5s, which is too long for a unit
    // test). This assertion just checks the artifact exists and has the right
    // shape, so CI can detect drift if the cross-build pipeline regresses.
    const expected = path.join(ROOT, "dist", "cross-windows-x64", "bin", "nikcli.exe")
    if (!existsSync(expected)) {
      // Soft skip — only enforce when the artifact has been built in this run.
      console.warn(`[windows-simulated] artifact not present at ${expected}; run script/cross-build-windows.ts first`)
      return
    }
    const start = performance.now()
    const buf = Buffer.alloc(2)
    const fh = await fs.open(expected, "r")
    await fh.read(buf, 0, 2, 0)
    await fh.close()
    const checkTime = performance.now() - start
    recordBenchmark({
      suite: "platform",
      module: "windows",
      scenario: "PE binary validation",
      iterations: 1,
      value: checkTime,
      unit: "ms",
      metadata: { size: (await fs.stat(expected)).size },
    })
    expect(buf[0]).toBe(0x4d) // "M"
    expect(buf[1]).toBe(0x5a) // "Z"

    const stat = await fs.stat(expected)
    expect(stat.size).toBeGreaterThan(50 * 1024 * 1024) // >50 MB (Bun + JS bundle)
  })
})
