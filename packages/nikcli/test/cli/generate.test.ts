import { describe, expect, it } from "bun:test"
import { GenerateCommand } from "@/cli/cmd/generate"

describe("generate OpenAPI source", () => {
  it("exposes one Effect-backed command without a backend selector", () => {
    expect(GenerateCommand.command).toBe("generate")
    expect("builder" in GenerateCommand).toBe(false)
  })
})
