import { describe, expect, it } from "bun:test"
import { ConfigMarkdown } from "@/config/markdown"
import { Config } from "@/config/config"
import { FormatError, FormatUnknownError } from "@/cli/error"
import { Agent } from "@/agent/agent"
import { MCP } from "@/mcp"
import { Provider } from "@/provider/provider"
import { UI } from "@/cli/ui"

describe("FormatError", () => {
  it("formats MCP.Failed", () => {
    const e = new MCP.Failed({ name: "myserver" })
    expect(FormatError(e)).toContain("myserver")
    expect(FormatError(e)).toContain("MCP")
  })

  it("formats Provider.ModelNotFoundError without suggestions", () => {
    const e = new Provider.ModelNotFoundError({
      providerID: "p",
      modelID: "m",
    })
    const out = FormatError(e)!
    expect(out).toContain("p/m")
    expect(out).toContain("nikcli models")
  })

  it("formats Provider.ModelNotFoundError with suggestions", () => {
    const e = new Provider.ModelNotFoundError({
      providerID: "p",
      modelID: "m",
      suggestions: ["a", "b"],
    })
    const out = FormatError(e)!
    expect(out).toContain("Did you mean")
    expect(out).toContain("a, b")
  })

  it("formats Provider.InitError", () => {
    const e = new Provider.InitError({ providerID: "anthropic" })
    expect(FormatError(e)).toContain("anthropic")
  })

  it("formats Agent.NotFoundError", () => {
    const e = new Agent.NotFoundError({ name: "missing" })
    const out = FormatError(e)!
    expect(out).toContain("missing")
    expect(out).toContain("nikcli agent list")
    expect(out).not.toContain("nikcli agents")
  })

  it("formats Config.JsonError without message", () => {
    const e = new Config.JsonError({ path: "/x/nikcli.json" })
    expect(FormatError(e)).toContain("/x/nikcli.json")
    expect(FormatError(e)).toContain("not valid JSON")
  })

  it("formats Config.JsonError with message", () => {
    const e = new Config.JsonError({ path: "/p", message: "bad" })
    expect(FormatError(e)).toContain("bad")
  })

  it("formats Config.ConfigDirectoryTypoError", () => {
    const e = new Config.ConfigDirectoryTypoError({
      path: "/c",
      dir: ".nikclie",
      suggestion: ".nikcli",
    })
    const out = FormatError(e)!
    expect(out).toContain(".nikclie")
    expect(out).toContain(".nikcli")
  })

  it("formats ConfigMarkdown.FrontmatterError", () => {
    const e = new ConfigMarkdown.FrontmatterError({
      path: "f.md",
      message: "yaml bad",
    })
    expect(FormatError(e)).toBe("yaml bad")
  })

  it("formats Config.InvalidError with path and message", () => {
    const e = new Config.InvalidError({ path: "cfg", message: "oops" })
    expect(FormatError(e)).toContain("oops")
    expect(FormatError(e)).toContain("cfg")
  })

  it("formats Config.InvalidError omitting path when path is the literal config", () => {
    const e = new Config.InvalidError({
      path: "config",
      message: "root issue",
    })
    const out = FormatError(e)!
    expect(out).toContain("Configuration is invalid")
    expect(out).toContain("root issue")
    expect(out).not.toContain(" at config")
  })

  it("formats Config.InvalidError with issues", () => {
    const e = new Config.InvalidError({
      path: "cfg",
      issues: [{ message: "required", path: ["a", "b"] } as any],
    })
    const out = FormatError(e)!
    expect(out).toContain("required")
    expect(out).toContain("a.b")
  })

  it("returns empty string for UI.CancelledError", () => {
    const e = new UI.CancelledError()
    expect(FormatError(e)).toBe("")
  })

  it("returns undefined for unrelated input", () => {
    expect(FormatError(new Error("x"))).toBeUndefined()
    expect(FormatError("string")).toBeUndefined()
    expect(FormatError(null)).toBeUndefined()
  })

  it("renders tag, message, and scalar fields for tagged errors without a dedicated formatter", () => {
    const out = FormatError({
      _tag: "AuthNotFound",
      message: "no stored credentials",
      providerID: "anthropic",
    })!
    expect(out).toContain("AuthNotFound")
    expect(out).toContain("no stored credentials")
    expect(out).toContain("providerID: anthropic")
  })

  it("renders the tag alone when a tagged error has no message or scalar fields", () => {
    expect(FormatError({ _tag: "FFFNotReadyError", nested: { deep: true } })).toBe("FFFNotReadyError")
  })
})

describe("FormatUnknownError", () => {
  it("formats Error with stack when present", () => {
    const err = new Error("boom")
    err.stack = "Error: boom\n  at x"
    expect(FormatUnknownError(err)).toContain("boom")
  })

  it("formats Error without stack using name and message", () => {
    const err = new Error("m")
    err.stack = undefined
    const out = FormatUnknownError(err)
    expect(out).toContain("Error")
    expect(out).toContain("m")
  })

  it("JSON-stringifies plain objects", () => {
    expect(FormatUnknownError({ a: 1 })).toContain('"a"')
    expect(FormatUnknownError({ a: 1 })).toContain("1")
  })

  it("handles unserializable object", () => {
    const o: Record<string, unknown> = {}
    o.self = o
    expect(FormatUnknownError(o)).toContain("unserializable")
  })

  it("stringifies primitives", () => {
    expect(FormatUnknownError(42)).toBe("42")
    expect(FormatUnknownError(true)).toBe("true")
  })
})
