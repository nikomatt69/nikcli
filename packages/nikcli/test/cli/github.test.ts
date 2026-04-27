import { describe, expect, it } from "bun:test"
import type { MessageV2 } from "@/session/message-v2"
import { extractResponseText, parseGitHubRemote } from "@/cli/cmd/github"

describe("parseGitHubRemote", () => {
  it("parses https URL with and without .git", () => {
    expect(parseGitHubRemote("https://github.com/foo/bar")).toEqual({ owner: "foo", repo: "bar" })
    expect(parseGitHubRemote("https://github.com/foo/bar.git")).toEqual({ owner: "foo", repo: "bar" })
  })

  it("parses git@ and ssh styles", () => {
    expect(parseGitHubRemote("git@github.com:acme/widget.git")).toEqual({ owner: "acme", repo: "widget" })
    expect(parseGitHubRemote("ssh://git@github.com/acme/widget")).toEqual({ owner: "acme", repo: "widget" })
  })

  it("returns null for non-GitHub remotes", () => {
    expect(parseGitHubRemote("https://gitlab.com/a/b")).toBeNull()
    expect(parseGitHubRemote("not a url")).toBeNull()
  })
})

describe("extractResponseText", () => {
  const base = { id: "p1", sessionID: "ses", messageID: "msg" }

  it("returns the last text part", () => {
    const parts = [
      { ...base, id: "p0", type: "text" as const, text: "first" },
      { ...base, type: "text" as const, text: "last" },
    ] as MessageV2.Part[]
    expect(extractResponseText(parts)).toBe("last")
  })

  it("returns null when there is reasoning but no text", () => {
    const parts = [
      {
        ...base,
        type: "reasoning" as const,
        text: "think",
        time: { start: 1, end: 2 },
      },
    ] as MessageV2.Part[]
    expect(extractResponseText(parts)).toBeNull()
  })

  it("returns null when the only signal is a completed tool", () => {
    const parts = [
      {
        ...base,
        type: "tool" as const,
        callID: "c1",
        tool: "bash",
        state: {
          status: "completed" as const,
          input: {},
          output: "ok",
          title: "t",
          metadata: {},
          time: { start: 1, end: 2 },
        },
      },
    ] as MessageV2.Part[]
    expect(extractResponseText(parts)).toBeNull()
  })

  it("throws when parts are empty", () => {
    expect(() => extractResponseText([])).toThrow(/Part types/)
  })
})
