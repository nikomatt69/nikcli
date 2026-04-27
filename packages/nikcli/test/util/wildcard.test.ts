import { describe, expect, it } from "bun:test"
import { Wildcard } from "@/util/wildcard"

describe("Wildcard", () => {
  describe("match", () => {
    it("matches exact strings", () => {
      expect(Wildcard.match("hello", "hello")).toBe(true)
      expect(Wildcard.match("hello", "world")).toBe(false)
    })

    it("handles * wildcard (any characters)", () => {
      expect(Wildcard.match("hello world", "*")).toBe(true)
      expect(Wildcard.match("anything", "test*")).toBe(false)
      expect(Wildcard.match("test-file.ts", "test*.ts")).toBe(true)
      expect(Wildcard.match("test.js", "test*.ts")).toBe(false)
    })

    it("handles ? wildcard (single character)", () => {
      expect(Wildcard.match("abc", "a?c")).toBe(true)
      expect(Wildcard.match("aXc", "a?c")).toBe(true)
      expect(Wildcard.match("axxc", "a?c")).toBe(false)
    })

    it("escapes special regex characters", () => {
      expect(Wildcard.match("file.name", "file.name")).toBe(true)
      // Backslash needs to be in pattern to match literal backslash
      expect(Wildcard.match("file\\.name", "file\\.name")).toBe(true)
      expect(Wildcard.match("a+b", "a+b")).toBe(true)
      expect(Wildcard.match("a$b", "a$b")).toBe(true)
    })

    it("handles pattern with multiple wildcards", () => {
      // * matches any characters including /
      expect(Wildcard.match("file.v1.ts", "file.*.ts")).toBe(true)
      expect(Wildcard.match("prefix-mid-suffix", "prefix-*-suffix")).toBe(true)
    })
  })

  describe("match edge cases", () => {
    it("handles empty pattern", () => {
      // Empty pattern becomes ^$ which only matches empty string
      expect(Wildcard.match("", "")).toBe(true)
      expect(Wildcard.match("anything", "")).toBe(false)
    })

    it("handles empty string", () => {
      expect(Wildcard.match("", "")).toBe(true)
      expect(Wildcard.match("", "*")).toBe(true)
      expect(Wildcard.match("", "test")).toBe(false)
    })

    it("handles * matching everything", () => {
      expect(Wildcard.match("anything here", "*")).toBe(true)
      expect(Wildcard.match("", "*")).toBe(true)
    })

    it("handles partial matches", () => {
      expect(Wildcard.match("hello world", "hello")).toBe(false)
      // *hello requires the string to start with anything and end with hello
      // Since "hello world" ends with "world", this doesn't match
      expect(Wildcard.match("hello", "*hello")).toBe(true)
      expect(Wildcard.match("prefix-hello", "*hello")).toBe(true)
    })

    it("handles trailing space with wildcard", () => {
      // Pattern "test *" is converted to "^test( .*)?$" which makes the space+* optional
      expect(Wildcard.match("test", "test *")).toBe(true)
      expect(Wildcard.match("test -la", "test *")).toBe(true)
      // This also matches because * matches any chars including spaces
      expect(Wildcard.match("test -la more", "test *")).toBe(true)
    })
  })

  describe("all", () => {
    it("returns first matching value", () => {
      const patterns = {
        exact: "exact-match",
        "prefix-*": "prefix-match",
        "*": "default",
      }

      expect(Wildcard.all("exact", patterns)).toBe("exact-match")
      expect(Wildcard.all("prefix-hello", patterns)).toBe("prefix-match")
      expect(Wildcard.all("something", patterns)).toBe("default")
    })

    it("respects pattern priority by length", () => {
      const patterns: Record<string, string> = {}
      patterns["abc"] = "abc"
      patterns["ab*"] = "ab-star"
      patterns["*"] = "star"

      // Longer patterns should be checked first
      expect(Wildcard.all("abc", patterns)).toBe("abc")
      expect(Wildcard.all("abd", patterns)).toBe("ab-star")
      expect(Wildcard.all("xyz", patterns)).toBe("star")
    })

    it("handles empty patterns object", () => {
      expect(Wildcard.all("test", {})).toBeUndefined()
    })

    it("continues searching after first match", () => {
      // all() returns first match but continues checking
      const patterns = {
        a: "first",
        "*": "second",
      }

      const result = Wildcard.all("a", patterns)
      expect(result).toBe("first")
    })
  })

  describe("allStructured", () => {
    it("matches head pattern", () => {
      const patterns = {
        "git add *": "git-add",
        "git commit *": "git-commit",
        "git *": "git-generic",
      }

      expect(Wildcard.allStructured({ head: "git", tail: ["add", "file"] }, patterns)).toBe("git-add")
      expect(Wildcard.allStructured({ head: "git", tail: ["commit", "-m", "msg"] }, patterns)).toBe("git-commit")
      expect(Wildcard.allStructured({ head: "git", tail: ["status"] }, patterns)).toBe("git-generic")
    })

    it("matches tail sequence", () => {
      const patterns = {
        "ls *": "ls-command",
        "ls -la *": "ls-detailed",
      }

      expect(Wildcard.allStructured({ head: "ls", tail: [] }, patterns)).toBe("ls-command")
      expect(Wildcard.allStructured({ head: "ls", tail: ["-la"] }, patterns)).toBe("ls-detailed")
      expect(Wildcard.allStructured({ head: "ls", tail: ["-la", "src"] }, patterns)).toBe("ls-detailed")
    })

    it("handles * in tail sequence", () => {
      const patterns = {
        "test *": "test-any",
      }

      expect(Wildcard.allStructured({ head: "test", tail: ["arg1"] }, patterns)).toBe("test-any")
      expect(Wildcard.allStructured({ head: "test", tail: ["arg1", "arg2"] }, patterns)).toBe("test-any")
    })

    it("handles no match", () => {
      const patterns = {
        "git add *": "git-add",
      }

      expect(Wildcard.allStructured({ head: "npm", tail: ["install"] }, patterns)).toBeUndefined()
    })
  })

  describe("matchSequence", () => {
    it("matches empty sequence with empty patterns", () => {
      // Internal behavior tested via allStructured
    })

    it("handles * in patterns matching any tail", () => {
      const patterns = {
        "cmd *": "cmd",
      }

      const result = Wildcard.allStructured({ head: "cmd", tail: ["arg1", "arg2", "arg3"] }, patterns)
      expect(result).toBe("cmd")
    })
  })

  describe("complex patterns", () => {
    it("handles file path patterns", () => {
      // * matches any characters including /
      expect(Wildcard.match("src/utils/helper.ts", "*.ts")).toBe(true)
      expect(Wildcard.match("test.tsx", "*.ts")).toBe(false)
      expect(Wildcard.match("helpers.ts", "*.ts")).toBe(true)
    })

    it("handles environment variable patterns", () => {
      expect(Wildcard.match("NODE_ENV=production", "NODE_ENV=*")).toBe(true)
      expect(Wildcard.match("PATH=/usr/bin", "PATH=*")).toBe(true)
      expect(Wildcard.match("HOME=/root", "USER=*")).toBe(false)
    })

    it("handles tool permission patterns", () => {
      expect(Wildcard.match("tool.read", "tool.*")).toBe(true)
      expect(Wildcard.match("tool.read", "*.read")).toBe(true)
      expect(Wildcard.match("tool.read", "*.*")).toBe(true)
      expect(Wildcard.match("other.tool", "tool.*")).toBe(false)
    })
  })
})
