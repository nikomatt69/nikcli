import { afterAll, describe, expect, it } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-index-help-"))
const xdgDataHome = path.join(testHome, "data")
// AccountDB opens SQLite at module load; initialize() runs later — ensure data dir exists first.
await fs.mkdir(path.join(xdgDataHome, "nikcli"), { recursive: true })

afterAll(async () => {
  await fs.rm(testHome, { recursive: true, force: true })
})

describe("CLI entrypoint (subprocess)", () => {
  it("prints help and exits successfully with isolated XDG + NIKCLI_TEST_HOME", async () => {
    const indexTs = path.join(import.meta.dir, "../../src/index.ts")
    const proc = Bun.spawn([Bun.which("bun")!, indexTs, "--help"], {
      cwd: path.join(import.meta.dir, "../.."),
      env: {
        ...process.env,
        NIKCLI_TEST_HOME: testHome,
        XDG_CONFIG_HOME: path.join(testHome, "cfg"),
        XDG_DATA_HOME: xdgDataHome,
        XDG_CACHE_HOME: path.join(testHome, "cache"),
        XDG_STATE_HOME: path.join(testHome, "state"),
        NIKCLI_DISABLE_PROJECT_CONFIG: "1",
      },
      stdout: "pipe",
      stderr: "pipe",
    })
    const code = await proc.exited
    const out = await new Response(proc.stdout).text()
    expect(code).toBe(0)
    expect(out).toContain("nikcli")
    expect(out.toLowerCase()).toContain("help")
  })
})
