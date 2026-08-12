import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { Filesystem } from "@/util/filesystem"
import { canCreateFileSymlinks, symlinkDir } from "../helpers/fs"

describe("Filesystem.realpathInside", () => {
  let root: string
  let outside: string

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-realpath-root-"))
    outside = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-realpath-outside-"))
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
    await fs.rm(outside, { recursive: true, force: true })
  })

  test("returns ok for a path directly inside the root", async () => {
    await fs.writeFile(path.join(root, "a.txt"), "x")
    const result = await Filesystem.realpathInside(root, path.join(root, "a.txt"))
    expect(result.ok).toBe(true)
    if (result.ok) {
      // The returned path is canonical, which differs from the lexical path
      // wherever the temp dir is not already canonical (macOS /tmp ->
      // /private/tmp; Windows C:\Users\RUNNER~1 -> C:\Users\runneradmin). A
      // string prefix check compares two spellings of the same directory, so
      // assert real containment with the module's own predicate instead.
      expect(Filesystem.containsCanonical(root, result.real)).toBe(true)
    }
  })

  test("returns ok for a nested file inside the root", async () => {
    const nested = path.join(root, "a", "b", "c.txt")
    await fs.mkdir(path.dirname(nested), { recursive: true })
    await fs.writeFile(nested, "x")
    const result = await Filesystem.realpathInside(root, nested)
    expect(result.ok).toBe(true)
  })

  test("rejects a path with `..` that escapes the root", async () => {
    const inside = path.join(root, "sub")
    await fs.mkdir(inside, { recursive: true })
    const escape = path.join(inside, "..", "..", "etc", "passwd")
    const result = await Filesystem.realpathInside(root, escape)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe("escape")
    }
  })

  test("rejects a symlink that points outside the root", async () => {
    await fs.writeFile(path.join(outside, "secret.txt"), "x")
    await symlinkDir(outside, path.join(root, "escape"))
    const result = await Filesystem.realpathInside(root, path.join(root, "escape", "secret.txt"))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe("symlink")
    }
  })

  // The leaf is a link to a *file*, which has no junction equivalent, so an
  // unprivileged Windows host cannot set this case up at all.
  test.skipIf(!canCreateFileSymlinks())("rejects a symlink whose leaf points outside the root", async () => {
    await fs.writeFile(path.join(outside, "secret.txt"), "x")
    const nested = path.join(root, "a", "b")
    await fs.mkdir(nested, { recursive: true })
    await fs.symlink(path.join(outside, "secret.txt"), path.join(nested, "leaf"))
    const result = await Filesystem.realpathInside(root, path.join(nested, "leaf"))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe("symlink")
    }
  })

  test("allows a non-existent write target inside the root", async () => {
    const target = path.join(root, "newdir", "newfile.txt")
    const result = await Filesystem.realpathInside(root, target)
    expect(result.ok).toBe(true)
  })

  test("rejects a non-existent path that lexically escapes the root", async () => {
    const target = path.join(root, "..", "outside", "ghost.txt")
    const result = await Filesystem.realpathInside(root, target)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe("escape")
    }
  })

  test("allows a symlink that points inside the root", async () => {
    const inner = path.join(root, "real")
    await fs.mkdir(inner, { recursive: true })
    await fs.writeFile(path.join(inner, "ok.txt"), "x")
    await symlinkDir(inner, path.join(root, "link"))
    const result = await Filesystem.realpathInside(root, path.join(root, "link", "ok.txt"))
    expect(result.ok).toBe(true)
  })

  test("returns ok for the root itself", async () => {
    const result = await Filesystem.realpathInside(root, root)
    expect(result.ok).toBe(true)
  })

  test("rejects when the root does not exist", async () => {
    const ghost = path.join(os.tmpdir(), "nikcli-realpath-ghost-" + Date.now())
    const result = await Filesystem.realpathInside(ghost, path.join(root, "a.txt"))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe("escape")
    }
  })

  test("handles a relative candidate", async () => {
    await fs.writeFile(path.join(root, "a.txt"), "x")
    const result = await Filesystem.realpathInside(root, "a.txt")
    expect(result.ok).toBe(true)
  })

  test("rejects a broken symlink that points outside the root", async () => {
    const ghost = path.join(os.tmpdir(), "nikcli-realpath-ghost-target-" + Date.now())
    await symlinkDir(ghost, path.join(root, "broken"))
    const result = await Filesystem.realpathInside(root, path.join(root, "broken"))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe("symlink")
    }
  })
})
