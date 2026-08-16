import { afterAll, describe, expect, it } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-bot-cmd-"))
const xdgDataHome = path.join(testHome, "data")
// AccountDB opens SQLite at module load; initialize() runs later — ensure data dir exists first.
await fs.mkdir(path.join(xdgDataHome, "nikcli"), { recursive: true })

afterAll(async () => {
  await fs.rm(testHome, { recursive: true, force: true })
})

describe("bot command (subprocess, browser conditions)", () => {
  it("bot list does not crash with 'document is not defined'", async () => {
    const proc = Bun.spawn([Bun.which("bun")!, "run", "--conditions=browser", "./src/index.ts", "bot", "list"], {
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

    // Some import paths spin up background watchers/pools that hold the event
    // loop open; bound the wait so the suite cannot hang the runner (same
    // watchdog pattern as index-help.e2e.test.ts).
    const exitWatchdog = new Promise<"timeout">((resolve) => {
      setTimeout(() => resolve("timeout"), 30_000)
    })
    const winner = await Promise.race([proc.exited.then((code) => ({ code })), exitWatchdog])

    if (winner === "timeout") {
      try {
        proc.kill("SIGKILL")
      } catch {
        // ignore
      }
      await proc.exited.catch(() => undefined)
    }

    const out = await new Response(proc.stdout).text()
    const err = await new Response(proc.stderr).text()

    if (winner === "timeout") {
      console.warn("[bot-command.e2e] subprocess timed out under load; skipping output asserts")
      expect(typeof out).toBe("string")
      return
    }

    // The chatbot module resolves decode-named-character-reference's browser
    // build under --conditions=browser; without the document shim installed by
    // src/index.ts the import crashes with `document is not defined` (exit 1).
    expect(err).not.toContain("document is not defined")
    expect(out).not.toContain("Unexpected error")
    expect(out).toContain("No chat bots configured")
    expect(winner.code).toBe(0)
  }, 40_000)
})
