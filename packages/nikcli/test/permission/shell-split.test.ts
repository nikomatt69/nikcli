import { describe, expect, it } from "bun:test"
import { splitShellStatements } from "@/permission/shell-split"

describe("splitShellStatements", () => {
  it("returns a single command unchanged", () => {
    expect(splitShellStatements("git status")).toEqual(["git status"])
  })

  it("splits the separators that chain independent commands", () => {
    expect(splitShellStatements("git status && rm -rf build")).toEqual(["git status", "rm -rf build"])
    expect(splitShellStatements("a || b")).toEqual(["a", "b"])
    expect(splitShellStatements("a; b")).toEqual(["a", "b"])
    expect(splitShellStatements("a\nb")).toEqual(["a", "b"])
  })

  it("splits pipelines so the receiving command is authorized on its own", () => {
    expect(splitShellStatements("git ls-files | xargs rm")).toEqual(["git ls-files", "xargs rm"])
  })

  it("keeps pipelines intact when the caller asks", () => {
    expect(splitShellStatements("git ls-files | xargs rm", { splitPipes: false })).toEqual(["git ls-files | xargs rm"])
  })

  it("ignores separators inside quotes", () => {
    expect(splitShellStatements(`echo "a && b"`)).toEqual([`echo "a && b"`])
    expect(splitShellStatements(`echo 'a; b'`)).toEqual([`echo 'a; b'`])
    expect(splitShellStatements("echo `a | b`")).toEqual(["echo `a | b`"])
  })

  it("ignores separators inside an escaped quote within a quoted string", () => {
    expect(splitShellStatements(`echo "a \\" && b"`)).toEqual([`echo "a \\" && b"`])
  })

  it("still splits a real separator that follows a quoted argument", () => {
    expect(splitShellStatements(`echo "hello; world" && rm -rf build`)).toEqual([`echo "hello; world"`, "rm -rf build"])
  })

  it("joins a backslash line continuation into one command", () => {
    expect(splitShellStatements("git commit \\\n  -m msg")).toEqual(["git commit   -m msg"])
  })

  it("drops empty segments from trailing and repeated separators", () => {
    expect(splitShellStatements("a;;b;")).toEqual(["a", "b"])
    expect(splitShellStatements("   ")).toEqual([])
  })

  it("keeps the tail when a quote is never closed", () => {
    // Mis-reading the line must not silently discard a command from the permission set.
    expect(splitShellStatements(`echo "unterminated && rm -rf build`)).toEqual([`echo "unterminated && rm -rf build`])
  })

  it("splits PowerShell statements the same way", () => {
    expect(splitShellStatements("Get-ChildItem -Recurse | Remove-Item -Force")).toEqual([
      "Get-ChildItem -Recurse",
      "Remove-Item -Force",
    ])
    expect(splitShellStatements("$env:CI = '1'; Remove-Item build")).toEqual(["$env:CI = '1'", "Remove-Item build"])
  })
})
