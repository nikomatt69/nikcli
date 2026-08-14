import { preserveTestEnv } from "../helpers/env"
import { afterAll, describe, expect, it } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { makeToolContext, withProjectDirectory } from "../helpers/tool-context"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-monitor-home-"))
process.env.NIKCLI_TEST_HOME = testHome
process.env.NIKCLI_DISABLE_PROJECT_CONFIG = "1"
process.env.NIKCLI_DB = path.join(testHome, "data", "nikcli.db")

preserveTestEnv(["NIKCLI_TEST_HOME", "NIKCLI_DISABLE_PROJECT_CONFIG", "NIKCLI_DB"])

const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-monitor-proj-"))

const { MonitorTool } = await import("@/tool/monitor")
const { Monitor } = await import("@/monitor/manager")
const { SessionError } = await import("@/session/error")
const { Instance } = await import("@/project/instance")
const { Database } = await import("@/database/database")

const def = await withProjectDirectory(projectDir, () => MonitorTool.init())

describe("MonitorTool", () => {
  afterAll(async () => {
    await Instance.disposeAll().catch(() => undefined)
    Database.close(path.join(testHome, "data", "nikcli.db"))
    await fs.rm(projectDir, { recursive: true, force: true }).catch(() => {})
    await fs.rm(testHome, { recursive: true, force: true }).catch(() => {})
  })

  it("rejects non-positive timeout before starting", async () => {
    const { ctx } = makeToolContext()
    await expect(
      withProjectDirectory(projectDir, () =>
        def.executeAsync({ command: "echo x", timeout: 0, title: "bad timeout" }, ctx),
      ),
    ).rejects.toThrow(/Invalid timeout/)
  })

  it("starts a background command and asks bash permission", async () => {
    const { ctx, asked } = makeToolContext()
    const result = await withProjectDirectory(projectDir, () =>
      def.executeAsync({ command: "echo monitor-ok", title: "echo monitor", wake: false }, ctx),
    )

    expect(result.output).toContain('Started monitor "echo monitor"')
    expect(result.output).toContain("Log file:")
    expect(result.metadata.monitorId).toBeTruthy()
    expect(result.metadata.command).toBe("echo monitor-ok")
    expect(result.metadata.status).toBe("running")
    expect(asked.some((a) => a.permission === "bash")).toBe(true)

    // Wait briefly for the short command to finish, then cancel if still up.
    await new Promise((r) => setTimeout(r, 200))
    await withProjectDirectory(projectDir, async () => {
      const record = await Monitor.get(ctx.sessionID, result.metadata.monitorId).catch(() => undefined)
      if (record?.status === "running") {
        await Monitor.cancel(ctx.sessionID, result.metadata.monitorId).catch(() => undefined)
      }
    })
  })

  it("defaults title from the command when omitted", async () => {
    const { ctx } = makeToolContext()
    const result = await withProjectDirectory(projectDir, () =>
      def.executeAsync({ command: "echo titled-from-cmd", wake: false }, ctx),
    )
    expect(result.title).toBe("echo titled-from-cmd")
    await withProjectDirectory(projectDir, async () => {
      await Monitor.cancel(ctx.sessionID, result.metadata.monitorId).catch(() => undefined)
    })
  })

  it("honours workdir for the monitored process", async () => {
    const nested = path.join(projectDir, "nested-mon")
    await fs.mkdir(nested)
    await fs.writeFile(path.join(nested, "flag.txt"), "yes\n")
    const { ctx } = makeToolContext()
    const result = await withProjectDirectory(projectDir, () =>
      def.executeAsync(
        { command: "test -f flag.txt && echo found", workdir: nested, title: "workdir check", wake: false },
        ctx,
      ),
    )
    expect(result.metadata.cwd).toBe(nested)
    await withProjectDirectory(projectDir, async () => {
      await Monitor.cancel(ctx.sessionID, result.metadata.monitorId).catch(() => undefined)
    })
  })

  it("throws SessionNotFoundError for a missing monitor", async () => {
    await expect(
      withProjectDirectory(projectDir, () => Monitor.get("ses_missing", "mon_missing")),
    ).rejects.toBeInstanceOf(SessionError.NotFoundError)
  })
})
