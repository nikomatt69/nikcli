import { describe, expect, it } from "bun:test"
import path from "path"
import { chdirToThreadDirectory, createWorkerEnv, resolveThreadDirectory, validateSession } from "@/cli/cmd/tui/thread"
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
})
