import { describe, expect, it } from "bun:test"
import { abbreviateHome, formatPath } from "@tui/util/path-format"

/**
 * One spelling for a path, everywhere it appears.
 *
 * There were two `normalizePath` helpers — one in the permission prompt, one in
 * the tool rows — and only the first abbreviated to `~`. The same file could be
 * `~/Projects/app/main.ts` in the prompt and `../../Projects/app/main.ts` in
 * the row underneath it.
 */

const base = "/Users/me/Projects/app"
const home = "/Users/me"

describe("formatPath", () => {
  it("shows a file inside the working directory relative to it", () => {
    expect(formatPath("/Users/me/Projects/app/src/main.ts", { base, home })).toBe("src/main.ts")
  })

  it("the working directory itself is `.`", () => {
    expect(formatPath(base, { base, home })).toBe(".")
  })

  it("resolves a relative input against the base before formatting", () => {
    expect(formatPath("src/main.ts", { base, home })).toBe("src/main.ts")
    expect(formatPath("./src/main.ts", { base, home })).toBe("src/main.ts")
  })

  /** The disagreement that started this: outside the cwd, but under home. */
  it("abbreviates a path outside the working directory but under home", () => {
    expect(formatPath("/Users/me/notes/todo.md", { base, home })).toBe("~/notes/todo.md")
    expect(formatPath("/Users/me/Projects/other/main.ts", { base, home })).toBe("~/Projects/other/main.ts")
  })

  it("stays absolute outside home, because a path you cannot locate is worse than a long one", () => {
    expect(formatPath("/etc/hosts", { base, home })).toBe("/etc/hosts")
  })

  it("without a home, anything outside the base stays absolute", () => {
    expect(formatPath("/Users/me/notes/todo.md", { base })).toBe("/Users/me/notes/todo.md")
  })

  it("an empty input is empty, not `.`", () => {
    expect(formatPath(undefined, { base, home })).toBe("")
    expect(formatPath("", { base, home })).toBe("")
  })

  it("a windows path against a posix base is shown rather than mangled", () => {
    expect(formatPath("C:\\Users\\me\\app\\main.ts", { base, home })).toBe("C:\\Users\\me\\app\\main.ts")
    expect(formatPath("C:\\Users\\me\\app\\main.ts", { base, home, forwardSlashes: true })).toBe(
      "C:/Users/me/app/main.ts",
    )
  })

  it("a windows base uses windows semantics", () => {
    expect(
      formatPath("C:\\Users\\me\\app\\src\\main.ts", { base: "C:\\Users\\me\\app", forwardSlashes: true }),
    ).toBe("src/main.ts")
  })
})

describe("abbreviateHome", () => {
  it("home itself is `~`", () => {
    expect(abbreviateHome(home, home)).toBe("~")
  })

  it("rewrites a descendant of home", () => {
    expect(abbreviateHome("/Users/me/notes/todo.md", home)).toBe("~/notes/todo.md")
  })

  /**
   * The reason this compares relative paths instead of testing a prefix:
   * `/Users/median` starts with `/Users/me` as a *string*, and a prefix check
   * would spell it `~dian`.
   */
  it("a sibling whose name merely starts with home is left alone", () => {
    expect(abbreviateHome("/Users/median/app", home)).toBe("/Users/median/app")
  })

  it("a path outside home is left alone", () => {
    expect(abbreviateHome("/etc/hosts", home)).toBe("/etc/hosts")
  })

  it("no home means nothing to abbreviate", () => {
    expect(abbreviateHome("/Users/me/notes", "")).toBe("/Users/me/notes")
  })
})
