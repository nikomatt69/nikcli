import { describe, expect, it } from "bun:test"
import { Process } from "@/util/process"

describe("Process metadata helpers", () => {
  it("sets stable run metadata on a provided env", () => {
    const env: NodeJS.ProcessEnv = {}

    const first = Process.ensureMetadata("main", env)
    const second = Process.ensureMetadata("worker", env)

    expect(first.runID).toBe(second.runID)
    expect(first.processRole).toBe("main")
    expect(second.processRole).toBe("main")
    expect(env[Process.RUN_ID_ENV]).toBe(first.runID)
    expect(env[Process.ROLE_ENV]).toBe("main")
  })

  it("filters undefined values and applies overrides for worker env", () => {
    const previous = process.env.NIKCLI_PROCESS_TEST
    process.env.NIKCLI_PROCESS_TEST = "kept"

    try {
      const env = Process.sanitizedEnv({ EXTRA_VALUE: "override" })

      expect(env.NIKCLI_PROCESS_TEST).toBe("kept")
      expect(env.EXTRA_VALUE).toBe("override")
      expect(Object.values(env).every((value) => value !== undefined)).toBe(true)
    } finally {
      if (previous === undefined) delete process.env.NIKCLI_PROCESS_TEST
      else process.env.NIKCLI_PROCESS_TEST = previous
    }
  })
})
