import { describe, expect, it } from "bun:test"
import { Commands } from "@/cli/commands"

describe("generate OpenAPI source", () => {
  it("exposes one command with no parameters of its own", () => {
    // Used to assert on the yargs command object; that object is gone, and the
    // spec tree is now where a command's shape is declared.
    const generate = Commands.commands["generate"]
    expect(generate).toBeDefined()
    expect(generate.spec.name).toBe("generate")
    // `config` is internal to effect's Command, so it is read through a cast.
    const config = (generate.spec as unknown as { config?: { flags?: unknown[]; arguments?: unknown[] } }).config ?? {}
    expect(config.flags ?? []).toEqual([])
    expect(config.arguments ?? []).toEqual([])
  })
})
