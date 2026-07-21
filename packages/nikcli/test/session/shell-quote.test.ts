import { describe, expect, it } from "bun:test"
import { quote } from "shell-quote"

// Regression tests for opencode upstream #38045. Previously the wrapper used
// `eval ${JSON.stringify(input.command)}` which mangles bash backslash
// continuations like `echo a \ && echo b`. After port D we use
// `shell-quote` which correctly preserves the escape semantics.
// `quote([cmd])` returns a single fully shell-safe string suitable for
// embedding in a wrapper script.

describe("shell-quote wrapping (opencode #38045)", () => {
  it("quotes a simple command", () => {
    const result = quote(["echo hello"])
    expect(result).toBe("'echo hello'")
  })

  it("preserves backslash continuations that JSON.stringify mangled", () => {
    // The wrapper previously did `eval ${JSON.stringify(input.command)}`.
    // JSON.stringify would turn the `\` into `\\`, turning the line
    // continuation into a literal backslash, which silently broke scripts
    // like `echo a \ && echo b`. shell-quote single-quotes the whole
    // command so the backslash is preserved verbatim and the bash
    // interpreter still sees the line continuation.
    const command = "echo a \\\n && echo b"
    const result = quote([command])
    expect(result).toBe(`'echo a \\\n && echo b'`)
  })

  it("safely quotes commands containing single quotes", () => {
    // shell-quote swaps to double quotes when no `$`, `` ` ``, or `\\` is in
    // the input, which lets it inline a literal single quote.
    const command = "echo it's me"
    const result = quote([command])
    expect(result).toBe(`"echo it's me"`)
    expect(result).toContain("it's me")
  })

  it("preserves $VARIABLE references inside the command", () => {
    const command = "echo $HOME"
    const result = quote([command])
    expect(result).toBe("'echo $HOME'")
    expect(result).toContain("$HOME")
  })

  it("preserves double-quoted arguments inside the command", () => {
    const command = 'echo "hello world"'
    const result = quote([command])
    expect(result).toBe(`'echo "hello world"'`)
    expect(result).toContain(`"hello world"`)
  })

  it("does not introduce command injection via $(...) inside input", () => {
    // The wrapper is interpolated into a here-doc passed to bash -c. The
    // shell-quote single-quoted form means the parent shell that interprets
    // the wrapper does NOT see $(...) as a command substitution during
    // wrapper generation — it is treated as literal text inside the
    // single-quoted string. The bash -c target shell then evaluates it
    // when the user runs the command.
    const command = "echo $(touch /tmp/pwned)"
    const result = quote([command])
    expect(result).toMatch(/^'.*'$/)
    expect(result).toContain("$(touch /tmp/pwned)")
  })

  it("returns a string (not an array)", () => {
    const result = quote(["echo hi"])
    expect(typeof result).toBe("string")
  })
})
