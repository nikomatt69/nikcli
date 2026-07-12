import { describe, expect, it } from "bun:test"
import path from "path"
import {
  chdirToThreadDirectory,
  createEventSource,
  createWorkerEnv,
  resolveThreadDirectory,
  validateSession,
} from "@/cli/cmd/tui/thread"
import { Process } from "@/util/process"

describe("TUI thread bootstrap", () => {
  it("resolves project paths relative to PWD", () => {
    const workspace = path.resolve("workspace")
    const other = path.resolve("other")
    const absoluteProject = path.resolve("repo")

    expect(resolveThreadDirectory("repo", workspace, other)).toBe(path.join(workspace, "repo"))
    expect(resolveThreadDirectory(absoluteProject, workspace, other)).toBe(absoluteProject)
    expect(resolveThreadDirectory(undefined, workspace, other)).toBe(other)
  })

  it("creates a worker env with process metadata", () => {
    const previousRunID = process.env[Process.RUN_ID_ENV]

    try {
      const env = createWorkerEnv({ CUSTOM_ENV: "1" })

      expect(env[Process.ROLE_ENV]).toBe("worker")
      expect(env[Process.RUN_ID_ENV]).toBeTruthy()
      expect(env.CUSTOM_ENV).toBe("1")
    } finally {
      if (previousRunID === undefined) delete process.env[Process.RUN_ID_ENV]
      else process.env[Process.RUN_ID_ENV] = previousRunID
    }
  })

  it("rejects malformed session ids before rendering", async () => {
    await expect(validateSession({ url: "http://nikcli.local", sessionID: "bad" })).rejects.toThrow(
      "Invalid session ID",
    )
  })

  it("chdirToThreadDirectory returns false when chdir fails", () => {
    const chdir = process.chdir
    process.chdir = (() => {
      throw new Error("ENOENT")
    }) as typeof process.chdir
    try {
      expect(chdirToThreadDirectory("/nonexistent-path-nikcli-thread-test")).toBe(false)
    } finally {
      process.chdir = chdir
    }
  })

  it("forwards global.event envelopes from the worker to the subscriber", async () => {
    type TestEnvelope = {
      directory?: string
      payload: { type: string; properties: Record<string, unknown> }
    }
    const envelope: TestEnvelope = {
      directory: "/tmp/worktree-a",
      payload: {
        type: "session.status",
        properties: { sessionID: "ses_test", status: { type: "busy" } },
      },
    }
    let listener: ((event: TestEnvelope) => void) | undefined
    let channel: string | undefined
    const client = {
      on: (name: string, callback: typeof listener) => {
        channel = name
        listener = callback
        return () => {
          listener = undefined
        }
      },
      call: async () => undefined,
    } as never
    const received: TestEnvelope[] = []

    const unsubscribe = await createEventSource(client).subscribe(undefined, (value) =>
      received.push(value as TestEnvelope),
    )
    expect(channel).toBe("global.event")

    listener?.(envelope)
    // Envelopes without a typed payload are dropped instead of crashing consumers.
    listener?.({ payload: undefined as never })

    expect(received).toEqual([envelope])
    unsubscribe()
  })
})
