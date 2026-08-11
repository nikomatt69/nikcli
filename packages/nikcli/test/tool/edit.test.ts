import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { EditTool, replace, replaceWithCount } from "@/tool/edit"
import { FileTime } from "@/file/time"
import { Instance } from "@/project/instance"
import { makeToolContext, withProjectDirectory } from "../helpers/tool-context"
import * as LineAnchor from "@/tool/line-anchor"

describe("EditTool", () => {
  let projectDir: string
  let def: Awaited<ReturnType<typeof EditTool.init>>

  beforeAll(async () => {
    projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-edit-test-"))
    def = await withProjectDirectory(projectDir, () => EditTool.init())
  })

  afterAll(async () => {
    await Instance.disposeAll().catch(() => undefined)
    await fs.rm(projectDir, { recursive: true, force: true }).catch(() => {})
  })

  it("replaces a unique string in an existing file", async () => {
    const filePath = path.join(projectDir, "replace.txt")
    await fs.writeFile(filePath, "hello world\n")
    const { ctx, sessionID, asked } = makeToolContext()

    const result = await withProjectDirectory(projectDir, async () => {
      await FileTime.read(sessionID, filePath)
      return def.executeAsync({ filePath, oldString: "world", newString: "nikcli" }, ctx)
    })
    expect(result.output).toContain("Replaced 1 occurrence")
    expect(await fs.readFile(filePath, "utf-8")).toBe("hello nikcli\n")
    expect(asked.some((a) => a.permission === "edit")).toBe(true)
  })

  describe("anchored edits", () => {
    const write = async (name: string, lines: string[]) => {
      const filePath = path.join(projectDir, name)
      await fs.writeFile(filePath, lines.join("\n"))
      return filePath
    }

    it("replaces the line an anchor names, without being told its text", async () => {
      const filePath = await write("anchored.ts", ["const a = 1", "const b = 2", "const c = 3"])
      const { ctx, sessionID } = makeToolContext()

      const result = await withProjectDirectory(projectDir, async () => {
        await FileTime.read(sessionID, filePath)
        return def.executeAsync(
          { filePath, anchor: LineAnchor.format(2, "const b = 2"), newString: "const b = 99" },
          ctx,
        )
      })

      expect(result.output).toContain("Replaced 1 occurrence")
      expect(await fs.readFile(filePath, "utf-8")).toBe("const a = 1\nconst b = 99\nconst c = 3")
    })

    it("refuses a stale anchor instead of editing whatever took that line", async () => {
      // The file moves after the anchor was taken. This is the case the digest
      // exists for: a line number alone would happily replace the new content.
      const filePath = await write("stale.ts", ["const a = 1", "const b = 2"])
      const stale = LineAnchor.format(2, "const b = 2")
      await fs.writeFile(filePath, ["const a = 1", "const b = SOMETHING ELSE"].join("\n"))
      const { ctx, sessionID } = makeToolContext()

      const attempt = withProjectDirectory(projectDir, async () => {
        await FileTime.read(sessionID, filePath)
        return def.executeAsync({ filePath, anchor: stale, newString: "const b = 99" }, ctx)
      })

      await expect(attempt).rejects.toThrow(/no longer matches/)
      // And the file is untouched — the refusal happens before the write.
      expect(await fs.readFile(filePath, "utf-8")).toBe("const a = 1\nconst b = SOMETHING ELSE")
    })

    it("refuses an anchor past the end of the file", async () => {
      const filePath = await write("short.ts", ["only one line"])
      const { ctx, sessionID } = makeToolContext()

      const attempt = withProjectDirectory(projectDir, async () => {
        await FileTime.read(sessionID, filePath)
        return def.executeAsync({ filePath, anchor: LineAnchor.format(9, "gone"), newString: "x" }, ctx)
      })

      await expect(attempt).rejects.toThrow(/has 1 line/)
    })

    it("refuses a malformed anchor rather than treating it as text", async () => {
      const filePath = await write("malformed.ts", ["a"])
      const { ctx, sessionID } = makeToolContext()

      const attempt = withProjectDirectory(projectDir, async () => {
        await FileTime.read(sessionID, filePath)
        return def.executeAsync({ filePath, anchor: "line 42", newString: "x" }, ctx)
      })

      await expect(attempt).rejects.toThrow(/Not a line anchor/)
    })

    it("refuses both ways of naming the target at once", async () => {
      const filePath = await write("both.ts", ["a"])
      const { ctx } = makeToolContext()

      const attempt = withProjectDirectory(projectDir, () =>
        def.executeAsync({ filePath, anchor: LineAnchor.format(1, "a"), oldString: "a", newString: "b" }, ctx),
      )

      await expect(attempt).rejects.toThrow(/not both/)
    })

    it("refuses neither", async () => {
      const filePath = await write("neither.ts", ["a"])
      const { ctx } = makeToolContext()

      const attempt = withProjectDirectory(projectDir, () => def.executeAsync({ filePath, newString: "b" }, ctx))

      await expect(attempt).rejects.toThrow(/required/)
    })
  })

  it("creates a new file when oldString is empty", async () => {
    const filePath = path.join(projectDir, "created.txt")
    const { ctx } = makeToolContext()
    const result = await withProjectDirectory(projectDir, () =>
      def.executeAsync({ filePath, oldString: "", newString: "brand new\n" }, ctx),
    )
    expect(result.output).toContain("Created file.")
    expect(await fs.readFile(filePath, "utf-8")).toBe("brand new\n")
  })

  it("replaceAll swaps every occurrence", async () => {
    const filePath = path.join(projectDir, "multi.txt")
    await fs.writeFile(filePath, "aa bb aa\n")
    const { ctx, sessionID } = makeToolContext()

    await withProjectDirectory(projectDir, async () => {
      await FileTime.read(sessionID, filePath)
      await def.executeAsync({ filePath, oldString: "aa", newString: "xx", replaceAll: true }, ctx)
    })
    expect(await fs.readFile(filePath, "utf-8")).toBe("xx bb xx\n")
  })

  it("rejects identical oldString and newString", async () => {
    const filePath = path.join(projectDir, "noop.txt")
    await fs.writeFile(filePath, "same\n")
    const { ctx, sessionID } = makeToolContext()

    await expect(
      withProjectDirectory(projectDir, async () => {
        await FileTime.read(sessionID, filePath)
        return def.executeAsync({ filePath, oldString: "same", newString: "same" }, ctx)
      }),
    ).rejects.toThrow(/identical/)
  })

  it("rejects edit when the file was never read", async () => {
    const filePath = path.join(projectDir, "unread.txt")
    await fs.writeFile(filePath, "secret\n")
    const { ctx } = makeToolContext()

    await expect(
      withProjectDirectory(projectDir, () =>
        def.executeAsync({ filePath, oldString: "secret", newString: "public" }, ctx),
      ),
    ).rejects.toThrow(/must read file/)
  })

  it("resolves relative filePath against the Instance directory", async () => {
    const relative = "relative-edit.txt"
    const absolute = path.join(projectDir, relative)
    await fs.writeFile(absolute, "before\n")
    const { ctx, sessionID } = makeToolContext()

    await withProjectDirectory(projectDir, async () => {
      // FileTime keys must match the path EditTool resolves (Instance.directory
      // may be realpath'd, e.g. /var → /private/var on macOS).
      const resolved = path.join(Instance.directory, relative)
      await FileTime.read(sessionID, resolved)
      await def.executeAsync({ filePath: relative, oldString: "before", newString: "after" }, ctx)
    })
    expect(await fs.readFile(absolute, "utf-8")).toBe("after\n")
  })
})

describe("UnicodeNormalizedReplacer", () => {
  const CURLY_SINGLE = "‘hello’"
  const CURLY_DOUBLE = "“hello”"
  const EM_DASH = "a—b"
  const NBSP = "a b"

  it("matches ASCII quotes against curly quotes in the source", () => {
    expect(replace(`const value = ${CURLY_SINGLE}\n`, "const value = 'hello'", "const value = 'bye'")).toBe(
      "const value = 'bye'\n",
    )
    expect(replace(`const value = ${CURLY_DOUBLE}\n`, 'const value = "hello"', 'const value = "bye"')).toBe(
      'const value = "bye"\n',
    )
  })

  it("matches curly quotes against ASCII quotes in the source", () => {
    expect(replace("const value = 'hello'\n", `const value = ${CURLY_SINGLE}`, "const value = 'bye'")).toBe(
      "const value = 'bye'\n",
    )
  })

  it("matches dashes and non-breaking spaces", () => {
    expect(replace(`x = ${EM_DASH}\n`, "x = a-b", "x = c")).toBe("x = c\n")
    expect(replace(`x = ${NBSP}\n`, "x = a b", "x = c")).toBe("x = c\n")
  })

  it("prefers an exact match over a normalized one", () => {
    const content = `first ${CURLY_SINGLE}\nsecond 'hello'\n`
    expect(replace(content, "second 'hello'", "second 'bye'")).toBe(`first ${CURLY_SINGLE}\nsecond 'bye'\n`)
  })

  it("rejects ambiguous normalized matches", () => {
    const content = `a ${CURLY_SINGLE}\nb ${CURLY_SINGLE}\n`
    expect(() => replace(content, "'hello'", "'bye'")).toThrow(/Found 2 matches/)
  })

  it("replaces every normalized occurrence with replaceAll", () => {
    const content = `a ${CURLY_SINGLE}\nb ${CURLY_SINGLE}\n`
    expect(replace(content, "'hello'", "'bye'", true)).toBe("a 'bye'\nb 'bye'\n")
  })

  it("leaves unrelated content untouched when nothing matches", () => {
    expect(() => replace("nothing here\n", "'missing'", "'x'")).toThrow(/Could not find/i)
  })
})

describe("replaceWithCount", () => {
  it("reports a single replacement", () => {
    expect(replaceWithCount("a b a", "b", "c")).toEqual({ content: "a c a", replacements: 1 })
  })

  it("reports how many occurrences replaceAll touched", () => {
    const result = replaceWithCount("x\nx\nx\n", "x", "y", true)
    expect(result.content).toBe("y\ny\ny\n")
    expect(result.replacements).toBe(3)
  })

  it("quantifies an ambiguous match instead of just refusing", () => {
    expect(() => replaceWithCount("dup\ndup\ndup\n", "dup", "one")).toThrow(/Found 3 matches/)
  })

  it("suggests replaceAll when the match is ambiguous", () => {
    expect(() => replaceWithCount("dup\ndup\n", "dup", "one")).toThrow(/replaceAll: true/)
  })

  it("names the file in a no-match failure", () => {
    expect(() => replaceWithCount("hello", "missing", "x", false, "/tmp/a.ts")).toThrow(
      /Could not find oldString in \/tmp\/a\.ts/,
    )
  })

  it("still refuses a no-op edit", () => {
    expect(() => replaceWithCount("hello", "same", "same")).toThrow(/identical/)
  })
})
