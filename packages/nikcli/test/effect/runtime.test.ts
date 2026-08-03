import { describe, expect, it } from "bun:test"
import { Layer } from "effect"
import { runtimeFor } from "@/effect/runtime"

describe("runtimeFor", () => {
  it("reuses runtimes within a test home and isolates different homes", () => {
    const previousHome = process.env.NIKCLI_TEST_HOME
    const previousDatabase = process.env.NIKCLI_DB
    const layer = Layer.empty

    try {
      process.env.NIKCLI_TEST_HOME = "/tmp/nikcli-runtime-a"
      process.env.NIKCLI_DB = "/tmp/nikcli-runtime-a/nikcli.db"
      const first = runtimeFor(layer)
      expect(runtimeFor(layer)).toBe(first)

      process.env.NIKCLI_TEST_HOME = "/tmp/nikcli-runtime-b"
      process.env.NIKCLI_DB = "/tmp/nikcli-runtime-b/nikcli.db"
      expect(runtimeFor(layer)).not.toBe(first)
    } finally {
      if (previousHome === undefined) delete process.env.NIKCLI_TEST_HOME
      else process.env.NIKCLI_TEST_HOME = previousHome
      if (previousDatabase === undefined) delete process.env.NIKCLI_DB
      else process.env.NIKCLI_DB = previousDatabase
    }
  })
})
