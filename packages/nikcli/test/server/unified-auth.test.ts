import { describe, expect, it } from "bun:test"

describe("unified server authentication", () => {
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
  })
})
