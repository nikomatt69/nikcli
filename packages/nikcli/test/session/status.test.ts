import fs from "fs/promises"
import os from "os"
import path from "path"
import { removeTestDir } from "../helpers/fs"
import { afterAll, afterEach, describe, expect, it } from "bun:test"
import { Instance } from "@/project/instance"
import { SessionStatus } from "@/session/status"
import { runPromiseWithLayer, withCurrentInstance } from "@/effect"
import { Effect } from "effect"

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

function runStatus<A, E>(effect: Effect.Effect<A, E, SessionStatus.Service>) {
  return runPromiseWithLayer(SessionStatus.defaultLayer, withCurrentInstance(effect))
}

function getStatus(sessionID: string) {
  return runStatus(
    Effect.gen(function* () {
      const status = yield* SessionStatus.Service
      return yield* status.get(sessionID)
    }),
  )
}

function setStatus(sessionID: string, input: SessionStatus.Info) {
  return runStatus(
    Effect.gen(function* () {
      const status = yield* SessionStatus.Service
      return yield* status.set(sessionID, input)
    }),
  )
}

function hydrateStatus(sessionID: string, input: SessionStatus.Info) {
  return runStatus(
    Effect.gen(function* () {
      const status = yield* SessionStatus.Service
      return yield* status.hydrate(sessionID, input)
    }),
  )
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
      await setStatus(sid, { type: "busy" })
      expect((await getStatus(sid)).type).toBe("busy")
      await hydrateStatus(sid, { type: "retry", attempt: 1, message: "m", next: 9 })
      expect((await getStatus(sid)).type).toBe("retry")
      await setStatus(sid, { type: "idle" })
      expect((await getStatus(sid)).type).toBe("idle")
    })
  })

  it("isolates state between projects", async () => {
    await withProject(async () => {
      await setStatus("shared-key", { type: "busy" })
      expect((await getStatus("shared-key")).type).toBe("busy")
    })
    await withProject(async () => {
      expect((await getStatus("shared-key")).type).toBe("idle")
    })
  })
})

afterEach(async () => {
  await Instance.disposeAll().catch(() => undefined)
})

afterAll(async () => {
  await Instance.disposeAll().catch(() => undefined)
  await Promise.all(projectDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })))
  await removeTestDir(testHome)
})
