import fs from "fs/promises"
import os from "os"
import path from "path"
import { afterAll, afterEach, describe, expect, it } from "bun:test"
import { Instance } from "@/project/instance"
import { SessionStatus } from "@/session/status"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-session-status-"))
process.env.NIKCLI_TEST_HOME = testHome
process.env.NIKCLI_DISABLE_PROJECT_CONFIG = "1"

const projectDirs: string[] = []

async function withProject<T>(fn: () => Promise<T> | T): Promise<T> {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-session-status-project-"))
  projectDirs.push(projectDir)
  return Instance.provide({
    directory: projectDir,
    fn,
  })
}

describe("SessionStatus", () => {
  it("parses Info union variants", () => {
    expect(SessionStatus.Info.parse({ type: "idle" })).toEqual({ type: "idle" })
    expect(SessionStatus.Info.parse({ type: "busy" })).toEqual({ type: "busy" })
    const retry = SessionStatus.Info.parse({
      type: "retry",
      attempt: 2,
      message: "retrying",
      next: 42,
    })
    expect(retry.type).toBe("retry")
    if (retry.type === "retry") {
      expect(retry.attempt).toBe(2)
      expect(retry.next).toBe(42)
    }
  })

  it("set/get/hydrate roundtrip per instance", async () => {
    await withProject(async () => {
      const sid = "status-a"
      SessionStatus.set(sid, { type: "busy" })
      expect(SessionStatus.get(sid).type).toBe("busy")
      SessionStatus.hydrate(sid, { type: "retry", attempt: 1, message: "m", next: 9 })
      expect(SessionStatus.get(sid).type).toBe("retry")
      SessionStatus.set(sid, { type: "idle" })
      expect(SessionStatus.get(sid).type).toBe("idle")
    })
  })

  it("isolates state between projects", async () => {
    await withProject(async () => {
      SessionStatus.set("shared-key", { type: "busy" })
      expect(SessionStatus.get("shared-key").type).toBe("busy")
    })
    await withProject(async () => {
      expect(SessionStatus.get("shared-key").type).toBe("idle")
    })
  })
})

afterEach(async () => {
  await Instance.disposeAll().catch(() => undefined)
})

afterAll(async () => {
  await Instance.disposeAll().catch(() => undefined)
  await Promise.all(projectDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })))
  await fs.rm(testHome, { recursive: true, force: true })
})
