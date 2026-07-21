import { describe, expect, it } from "bun:test"
import { Config } from "@/config/config"

describe("Config.LSP min_severity (opencode #17877)", () => {
  it("accepts a per-server min_severity integer 1-4", () => {
    const parsed = Config.Info.shape.lsp?.parse({
      markdownlint: {
        command: ["markdownlint-lsp"],
        extensions: [".md"],
        min_severity: 2,
      },
    })
    expect(parsed).toBeDefined()
  })

  it("rejects min_severity outside 1..4", () => {
    expect(() =>
      Config.Info.shape.lsp?.parse({
        markdownlint: {
          command: ["markdownlint-lsp"],
          extensions: [".md"],
          min_severity: 5,
        },
      }),
    ).toThrow()
    expect(() =>
      Config.Info.shape.lsp?.parse({
        markdownlint: {
          command: ["markdownlint-lsp"],
          extensions: [".md"],
          min_severity: 0,
        },
      }),
    ).toThrow()
  })

  it("omits min_severity when unset (default = Error)", () => {
    const parsed = Config.Info.shape.lsp?.parse({
      markdownlint: {
        command: ["markdownlint-lsp"],
        extensions: [".md"],
      },
    })
    expect(parsed).toBeDefined()
  })
})

describe("Config.small_model empty string (opencode #21184)", () => {
  it("accepts empty string as an explicit disabled value", () => {
    // The Zod string schema accepts "" without error; semantics: disabled.
    const parsed = Config.Info.shape.small_model?.parse("")
    expect(parsed).toBe("")
  })
})
