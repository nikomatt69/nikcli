import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { preserveTestEnv } from "../helpers/env"

/** Private home for the same reason as `edit.test.ts`: keep the project row off the real db. */
const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-multiedit-home-"))
process.env.NIKCLI_TEST_HOME = testHome
process.env.NIKCLI_DISABLE_PROJECT_CONFIG = "1"
preserveTestEnv(["NIKCLI_TEST_HOME", "NIKCLI_DISABLE_PROJECT_CONFIG"])

const { MultiEditTool } = await import("@/tool/multiedit")
const { FileTime } = await import("@/file/time")
const { Instance } = await import("@/project/instance")
const { makeToolContext, withProjectDirectory } = await import("../helpers/tool-context")

describe("MultiEditTool", () => {
  let projectDir: string
  let def: Awaited<ReturnType<typeof MultiEditTool.init>>

  beforeAll(async () => {
    projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-multiedit-test-"))
    def = await withProjectDirectory(projectDir, () => MultiEditTool.init())
  })

  afterAll(async () => {
    await Instance.disposeAll().catch(() => undefined)
    await fs.rm(projectDir, { recursive: true, force: true }).catch(() => {})
    await fs.rm(testHome, { recursive: true, force: true }).catch(() => {})
  })

  it("applies every edit in sequence and asks once", async () => {
    const filePath = path.join(projectDir, "sequence.txt")
    await fs.writeFile(filePath, "alpha\nbeta\ngamma\n")
    const { ctx, sessionID, asked } = makeToolContext()

    const result = await withProjectDirectory(projectDir, async () => {
      await FileTime.read(sessionID, filePath)
      return def.executeAsync(
        {
          filePath,
          edits: [
            { oldString: "alpha", newString: "one" },
            { oldString: "beta", newString: "two" },
            { oldString: "gamma", newString: "three" },
          ],
        },
        ctx,
      )
    })

    expect(await fs.readFile(filePath, "utf-8")).toBe("one\ntwo\nthree\n")
    expect(result.output).toContain("Replaced 3 occurrences")
    // One batch, one prompt — not one per edit.
    expect(asked.filter((a) => a.permission === "edit")).toHaveLength(1)
  })

  it("matches a later oldString against the file the model read, not a reformatted one", async () => {
    // The old implementation ran the whole edit tool per entry, so the formatter rewrote the file
    // between edits and edit 2 was matched against text nobody had seen.
    const filePath = path.join(projectDir, "chained.ts")
    await fs.writeFile(filePath, "const a = 1\nconst b = 2\n")
    const { ctx, sessionID } = makeToolContext()

    await withProjectDirectory(projectDir, async () => {
      await FileTime.read(sessionID, filePath)
      return def.executeAsync(
        {
          filePath,
          edits: [
            { oldString: "const a = 1", newString: "const a = 10" },
            { oldString: "const b = 2", newString: "const b = 20" },
          ],
        },
        ctx,
      )
    })

    const after = await fs.readFile(filePath, "utf-8")
    expect(after).toContain("const a = 10")
    expect(after).toContain("const b = 20")
  })

  it("is atomic: a failing edit leaves the file untouched", async () => {
    const filePath = path.join(projectDir, "atomic.txt")
    await fs.writeFile(filePath, "keep me\n")
    const { ctx, sessionID } = makeToolContext()

    const run = withProjectDirectory(projectDir, async () => {
      await FileTime.read(sessionID, filePath)
      return def.executeAsync(
        {
          filePath,
          edits: [
            { oldString: "keep me", newString: "changed" },
            { oldString: "not in the file", newString: "never written" },
          ],
        },
        ctx,
      )
    })

    await expect(run).rejects.toThrow(/Could not find oldString/)
    expect(await fs.readFile(filePath, "utf-8")).toBe("keep me\n")
  })

  it("reports an ambiguous match instead of guessing", async () => {
    const filePath = path.join(projectDir, "ambiguous.txt")
    await fs.writeFile(filePath, "dup\ndup\n")
    const { ctx, sessionID } = makeToolContext()

    const run = withProjectDirectory(projectDir, async () => {
      await FileTime.read(sessionID, filePath)
      return def.executeAsync({ filePath, edits: [{ oldString: "dup", newString: "x" }] }, ctx)
    })

    await expect(run).rejects.toThrow(/Found 2 matches/)
    expect(await fs.readFile(filePath, "utf-8")).toBe("dup\ndup\n")
  })

  it("creates a file from an empty first oldString and edits the new content", async () => {
    const filePath = path.join(projectDir, "created.txt")
    const { ctx } = makeToolContext()

    const result = await withProjectDirectory(projectDir, () =>
      def.executeAsync(
        {
          filePath,
          edits: [
            { oldString: "", newString: "hello placeholder\n" },
            { oldString: "placeholder", newString: "world" },
          ],
        },
        ctx,
      ),
    )

    expect(await fs.readFile(filePath, "utf-8")).toBe("hello world\n")
    expect(result.output).toContain("Created file.")
  })

  it("replaceAll sweeps every occurrence of one edit", async () => {
    const filePath = path.join(projectDir, "sweep.txt")
    await fs.writeFile(filePath, "old old old\nkeep\n")
    const { ctx, sessionID } = makeToolContext()

    const result = await withProjectDirectory(projectDir, async () => {
      await FileTime.read(sessionID, filePath)
      return def.executeAsync(
        {
          filePath,
          edits: [
            { oldString: "old", newString: "new", replaceAll: true },
            { oldString: "keep", newString: "kept" },
          ],
        },
        ctx,
      )
    })

    expect(await fs.readFile(filePath, "utf-8")).toBe("new new new\nkept\n")
    expect(result.output).toContain("Replaced 4 occurrences")
  })

  it("rejects an edit whose strings are identical without writing", async () => {
    const filePath = path.join(projectDir, "identical.txt")
    await fs.writeFile(filePath, "same\n")
    const { ctx, sessionID } = makeToolContext()

    const run = withProjectDirectory(projectDir, async () => {
      await FileTime.read(sessionID, filePath)
      return def.executeAsync({ filePath, edits: [{ oldString: "same", newString: "same" }] }, ctx)
    })

    await expect(run).rejects.toThrow(/identical/)
    expect(await fs.readFile(filePath, "utf-8")).toBe("same\n")
  })
})
