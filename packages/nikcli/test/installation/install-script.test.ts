/**
 * Behavioral tests for the bash install script (../../../../install).
 *
 * The existing `test/release/automation.test.ts` only checks that certain
 * strings are present in the installer source. These tests actually invoke
 * the script in a controlled environment — a sandboxed HOME, a fake
 * `uname`/`cygpath`/`powershell.exe`/`mv` on PATH, and pre-staged binary
 * contents — and assert that the install path behaves correctly for the
 * cases we can exercise on a Linux host.
 *
 * The Windows "deferred replace while nikcli.exe is locked" path requires
 * a real Windows lock on the running binary; on Linux `mv -f` of a regular
 * file over an existing file in the same filesystem always succeeds. We
 * simulate the lock by prepending a `mv` shim that fails when the second
 * argument already exists — emulating the Windows "rename over a locked
 * file returns ERROR_SHARING_VIOLATION" semantics.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import fs from "node:fs/promises"
import { existsSync } from "node:fs"
import os from "node:os"
import path from "node:path"

const ROOT = path.resolve(import.meta.dir, "../../../..")
const INSTALL = path.join(ROOT, "install")

interface FakeToolOpts {
  /** What `uname -s` should print. */
  unameS: string
  /** What `uname -m` should print. */
  unameM: string
  /** If set, `cygpath -w <arg>` writes this string (no newline). */
  cygpathOutput?: string
  /** If true, write a `powershell.exe` shim that logs invocations. */
  powershell?: boolean
  /** If true, `mv` fails when the destination already exists (Windows lock). */
  lockedMv?: boolean
}

/** Build a sandbox PATH with shimmed binaries. */
async function buildFakeBin(opts: FakeToolOpts): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-install-bin-"))

  await fs.writeFile(
    path.join(dir, "uname"),
    `#!/usr/bin/env bash
case "$1" in
  -s) printf '%s' '${opts.unameS}' ;;
  -m) printf '%s' '${opts.unameM}' ;;
  *) printf 'fake-uname' ;;
esac
`,
    { mode: 0o755 },
  )

  await fs.writeFile(
    path.join(dir, "cygpath"),
    `#!/usr/bin/env bash
printf '%s' '${opts.cygpathOutput ?? "C:\\\\fake"}'
`,
    { mode: 0o755 },
  )

  if (opts.lockedMv) {
    // Locked mv: succeeds if destination does not exist; fails otherwise.
    // This emulates the Windows "rename over a locked file returns
    // ERROR_SHARING_VIOLATION" semantics without needing a real OS lock.
    await fs.writeFile(
      path.join(dir, "mv"),
      `#!/usr/bin/env bash
LAST=""
for arg in "$@"; do LAST="$arg"; done
if [ "$#" -ge 2 ] && [ -e "$LAST" ]; then
  echo "fake-locked-mv: cannot overwrite '$LAST'" >&2
  exit 1
fi
exec /bin/mv "$@"
`,
      { mode: 0o755 },
    )
  } else {
    await fs.writeFile(path.join(dir, "mv"), `#!/usr/bin/env bash\nexec /bin/mv "$@"\n`, { mode: 0o755 })
  }

  if (opts.powershell) {
    await fs.writeFile(
      path.join(dir, "powershell.exe"),
      `#!/usr/bin/env bash
echo "fake-powershell called with: $*" >> "${dir}/powershell.log"
exit 0
`,
      { mode: 0o755 },
    )
  }

  return dir
}

interface RunInstallOpts {
  /** Sandbox HOME; will be created. */
  home: string
  /** Sandbox PATH prepended with fake tools. */
  fakeBinDir: string
  /** Extra env vars passed to the install script. */
  env?: Record<string, string>
  /** Args passed to the install script. */
  args?: string[]
}

/** Invoke the install script in-process via Bash. Returns stdout/stderr/exitCode. */
async function runInstall(opts: RunInstallOpts): Promise<{ stdout: string; stderr: string; code: number }> {
  await fs.mkdir(opts.home, { recursive: true })

  const env: Record<string, string> = {
    ...process.env,
    HOME: opts.home,
    PATH: `${opts.fakeBinDir}:${process.env.PATH ?? ""}`,
    NO_COLOR: "1",
    ...opts.env,
  }
  // GitHub Actions plumbing is not relevant here.
  delete env.GITHUB_ACTIONS
  delete env.GITHUB_PATH

  const proc = Bun.spawn({
    cmd: ["bash", INSTALL, ...(opts.args ?? [])],
    cwd: ROOT,
    stdout: "pipe",
    stderr: "pipe",
    env,
  })

  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
  const code = await proc.exited
  return { stdout, stderr, code }
}

const SAMPLE_BINARY = Buffer.from("#!/bin/sh\necho fake-binary\n")
const SAMPLE_BINARY_V2 = Buffer.from("#!/bin/sh\necho fake-binary-v2\n")

const tempDirs: string[] = []
function trackTemp(d: string) {
  tempDirs.push(d)
}

afterAll(async () => {
  await Promise.all(tempDirs.map((d) => fs.rm(d, { recursive: true, force: true }).catch(() => undefined)))
})

describe("install script — non-Windows direct replace", () => {
  let home: string
  let fakeBin: string

  beforeAll(async () => {
    home = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-home-"))
    trackTemp(home)
    fakeBin = await buildFakeBin({
      unameS: "Linux",
      unameM: "x86_64",
    })
    trackTemp(fakeBin)
  })

  it("installs the binary to ~/.nikcli/bin/nikcli on Linux with mode 0o755", async () => {
    const stagedBinary = path.join(fakeBin, "nikcli")
    await fs.writeFile(stagedBinary, SAMPLE_BINARY, { mode: 0o755 })

    const { code, stderr } = await runInstall({
      home,
      fakeBinDir: fakeBin,
      args: ["--binary", stagedBinary],
    })

    expect(code).toBe(0)
    expect(stderr).toContain("Using local binary")
    expect(stderr).toContain("Installed to")

    const dest = path.join(home, ".nikcli", "bin", "nikcli")
    expect(existsSync(dest)).toBe(true)
    const mode = (await fs.stat(dest)).mode & 0o777
    expect(mode).toBe(0o755)
  })
})

describe("install script — Windows first install (no existing binary)", () => {
  let home: string
  let fakeBin: string

  beforeAll(async () => {
    home = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-home-win-first-"))
    trackTemp(home)
    fakeBin = await buildFakeBin({
      unameS: "MINGW64_NT-10.0-19045",
      unameM: "x86_64",
      cygpathOutput: "C:\\fake\\path",
    })
    trackTemp(fakeBin)
  })

  it("uses nikcli.exe as the destination name on Windows when no binary is installed yet", async () => {
    const stagedBinary = path.join(fakeBin, "nikcli.exe")
    await fs.writeFile(stagedBinary, SAMPLE_BINARY, { mode: 0o755 })

    const { code, stderr } = await runInstall({
      home,
      fakeBinDir: fakeBin,
      args: ["--binary", stagedBinary],
    })

    expect(code).toBe(0)
    const dest = path.join(home, ".nikcli", "bin", "nikcli.exe")
    expect(existsSync(dest)).toBe(true)

    // PowerShell is NOT called on the first-install path.
    const powershellLog = path.join(fakeBin, "powershell.log")
    expect(existsSync(powershellLog)).toBe(false)
  })
})

describe("install script — Windows locked binary with PowerShell available", () => {
  let home: string
  let fakeBin: string

  beforeAll(async () => {
    home = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-home-win-locked-"))
    trackTemp(home)
    fakeBin = await buildFakeBin({
      unameS: "MINGW64_NT-10.0-19045",
      unameM: "x86_64",
      cygpathOutput: "C:\\fake\\translated",
      powershell: true,
      lockedMv: true,
    })
    trackTemp(fakeBin)

    // Pre-populate the destination so install_binary takes the deferred path.
    const installDir = path.join(home, ".nikcli", "bin")
    await fs.mkdir(installDir, { recursive: true })
    const dest = path.join(installDir, "nikcli.exe")
    await fs.writeFile(dest, SAMPLE_BINARY_V2, { mode: 0o755 })
  })

  it("stages the new binary and defers finalization via powershell.exe", async () => {
    const stagedBinary = path.join(fakeBin, "nikcli.exe.new")
    await fs.writeFile(stagedBinary, SAMPLE_BINARY, { mode: 0o755 })

    const { code, stderr } = await runInstall({
      home,
      fakeBinDir: fakeBin,
      args: ["--binary", stagedBinary],
    })

    expect(code).toBe(0)
    expect(stderr).toContain("Update staged; restart nikcli to finish")

    // PowerShell shim was invoked exactly once with the helper file.
    const powershellLog = path.join(fakeBin, "powershell.log")
    expect(existsSync(powershellLog)).toBe(true)
    const log = await fs.readFile(powershellLog, "utf8")
    expect(log).toContain("fake-powershell called with")
    expect(log).toContain("-File")
  })

  it("passes the cygpath-translated Windows path to powershell.exe", async () => {
    // Reuse the same fakeBin — the powershell log is appended-to across
    // tests in the suite. Reset it for this assertion.
    const powershellLog = path.join(fakeBin, "powershell.log")
    await fs.rm(powershellLog, { force: true })

    const stagedBinary = path.join(fakeBin, "nikcli.exe.again")
    await fs.writeFile(stagedBinary, SAMPLE_BINARY, { mode: 0o755 })

    const { code } = await runInstall({
      home,
      fakeBinDir: fakeBin,
      args: ["--binary", stagedBinary],
    })

    expect(code).toBe(0)
    const log = await fs.readFile(powershellLog, "utf8")
    // Every translated path should be the cygpath output, never the raw
    // POSIX /c/Users/... form.
    expect(log).toContain("C:\\fake\\translated")
    expect(log).not.toMatch(/\/c\/[A-Za-z]/)
  })
})

describe("install script — Windows locked binary without PowerShell", () => {
  let home: string
  let fakeBin: string

  beforeAll(async () => {
    home = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-home-win-nops-"))
    trackTemp(home)
    fakeBin = await buildFakeBin({
      unameS: "MINGW64_NT-10.0-19045",
      unameM: "x86_64",
      cygpathOutput: "C:\\fake\\path",
      // Note: NO powershell.exe in PATH, mv is locked
      lockedMv: true,
    })
    trackTemp(fakeBin)

    const installDir = path.join(home, ".nikcli", "bin")
    await fs.mkdir(installDir, { recursive: true })
    const dest = path.join(installDir, "nikcli.exe")
    await fs.writeFile(dest, SAMPLE_BINARY_V2, { mode: 0o755 })
  })

  it("exits non-zero and does NOT leave a pending file behind", async () => {
    const stagedBinary = path.join(fakeBin, "nikcli.exe.new")
    await fs.writeFile(stagedBinary, SAMPLE_BINARY, { mode: 0o755 })

    const { code, stderr } = await runInstall({
      home,
      fakeBinDir: fakeBin,
      args: ["--binary", stagedBinary],
    })

    // Without PowerShell, the installer must NOT claim success and must
    // leave no .new.<pid> files on disk.
    expect(code).not.toBe(0)
    expect(stderr).toContain("powershell.exe is unavailable")

    const installDir = path.join(home, ".nikcli", "bin")
    const files = await fs.readdir(installDir)
    const stragglers = files.filter((f) => f.includes(".new."))
    expect(stragglers).toEqual([])
  })
})
