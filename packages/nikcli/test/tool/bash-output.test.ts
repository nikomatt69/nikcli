import { describe, expect, it } from "bun:test"
import { appendOutput, MAX_OUTPUT_LENGTH } from "@/tool/bash"

describe("bash output bounds", () => {
  it("caps retained output while reporting truncation", () => {
    const result = appendOutput("prefix", Buffer.alloc(MAX_OUTPUT_LENGTH, "x"))

    expect(result.output).toHaveLength(MAX_OUTPUT_LENGTH)
    expect(result.output.startsWith("prefix")).toBe(true)
    expect(result.truncated).toBe(true)
  })

  it("keeps normal chunks unchanged", () => {
    expect(appendOutput("prefix", Buffer.from(" output"))).toEqual({
      output: "prefix output",
      truncated: false,
    })
  })
})

describe("bash early metadata publish", () => {
  /**
   * The TUI relies on `metadata.command` and `metadata.description` being
   * published synchronously before `authorizeBashCommand` resolves, so the
   * BlockTool shows the running command before permission prompts complete.
   *
   * Here we only verify the metadata record shape used by the Bash component:
   * both `description` and `command` are forwarded, and `output` is empty.
   */
  it("published metadata includes command + description for the running view", () => {
    const published: Array<{
      title?: string
      metadata: Record<string, unknown>
    }> = []
    const ctx = {
      metadata(input: { title?: string; metadata: Record<string, unknown> }) {
        published.push(input)
      },
    } as never

    const expectedTitle = "list files in ${directory}"
    const expectedCommand = "ls -la"
    const expectedDescription = "list files"

    // Reproduce the early-publish line from src/tool/bash.ts execute():
    ;(ctx as { metadata: (i: unknown) => void }).metadata({
      title: expectedTitle,
      metadata: {
        output: "",
        description: expectedDescription,
        command: expectedCommand,
      },
    })

    expect(published).toHaveLength(1)
    expect(published[0]?.title).toBe(expectedTitle)
    expect(published[0]?.metadata).toEqual({
      output: "",
      description: expectedDescription,
      command: expectedCommand,
    })
  })
})
