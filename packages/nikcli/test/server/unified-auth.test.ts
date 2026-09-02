import { describe, expect, it } from "bun:test"

describe("unified server authentication", () => {
  // This spawns a whole `bun test` child, which boots a server and runs six
  // cases; measured cold it lands within a few hundred ms of bun's *default*
  // 5s timeout, so the default is a coin flip under any load rather than a
  // real budget. The assertion is the child's exit code, not its speed.
  it("passes the hosted OAuth matrix in an isolated process", async () => {
    const child = Bun.spawn(["bun", "test", "./test/server/unified-auth.fixture.ts"], {
      cwd: import.meta.dir + "/../..",
      env: { ...process.env, NIKCLI_UNIFIED_AUTH_FIXTURE: "1" },
      stdout: "pipe",
      stderr: "pipe",
    })
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    expect(exitCode, `${stdout}\n${stderr}`).toBe(0)
    expect(`${stdout}\n${stderr}`).toContain("6 pass")
  }, 60_000)
})
