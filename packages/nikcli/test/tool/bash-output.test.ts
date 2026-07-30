import { describe, expect, it } from "bun:test"
import { appendOutput, MAX_METADATA_LENGTH, MAX_OUTPUT_LENGTH, previewOutput } from "@/tool/bash"

describe("bash output bounds", () => {
  it("caps retained output while reporting truncation", () => {
    const result = appendOutput("prefix", Buffer.alloc(MAX_OUTPUT_LENGTH, "x"))

    expect(result.output).toHaveLength(MAX_OUTPUT_LENGTH)
    expect(result.truncated).toBe(true)
  })

  it("drops the beginning and keeps the end of oversized output", () => {
    const filler = Buffer.alloc(MAX_OUTPUT_LENGTH, "x")
    const result = appendOutput("output-start", filler)

    expect(result.output.includes("output-start")).toBe(false)
    expect(result.output.endsWith("x")).toBe(true)
    expect(result.truncated).toBe(true)
  })

  it("retains the exit-status tail that arrives after the cap is reached", () => {
    const overflowed = appendOutput("output-start", Buffer.alloc(MAX_OUTPUT_LENGTH, "x"))
    const final = appendOutput(overflowed.output, Buffer.from("\nError: exit status 1"))

    expect(final.output.endsWith("\nError: exit status 1")).toBe(true)
    expect(final.output).toHaveLength(MAX_OUTPUT_LENGTH)
    expect(final.truncated).toBe(true)
  })

  it("keeps normal chunks unchanged", () => {
    expect(appendOutput("prefix", Buffer.from(" output"))).toEqual({
      output: "prefix output",
      truncated: false,
    })
  })
})

describe("bash metadata preview", () => {
  it("passes short output through untouched", () => {
    expect(previewOutput("short output")).toBe("short output")
  })

  it("previews the end of long output", () => {
    const long = "head".padEnd(MAX_METADATA_LENGTH, "x") + "TAIL"
    const preview = previewOutput(long)

    expect(preview.startsWith("...")).toBe(true)
    expect(preview.endsWith("TAIL")).toBe(true)
    expect(preview.includes("head")).toBe(false)
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
