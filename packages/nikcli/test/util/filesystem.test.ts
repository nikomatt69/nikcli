import { describe, expect, it, beforeEach, afterEach } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { Filesystem } from "@/util/filesystem"

describe("Filesystem", () => {
  let testDir: string

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-filesystem-test-"))
  })

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true })
  })

  describe("contains", () => {
    it("returns true when path is contained", () => {
      expect(Filesystem.contains("/home/user", "/home/user/project")).toBe(true)
      expect(Filesystem.contains("/home", "/home/user")).toBe(true)
    })

    it("returns false when path is not contained", () => {
      expect(Filesystem.contains("/home/user", "/var/www")).toBe(false)
      expect(Filesystem.contains("/home/user", "/home/user/../other")).toBe(false)
    })

    it("handles same path", () => {
      expect(Filesystem.contains("/home/user", "/home/user")).toBe(true)
    })

    it("handles nested paths", () => {
      expect(Filesystem.contains("/a/b", "/a/b/c/d")).toBe(true)
      expect(Filesystem.contains("/a/b/c", "/a/b")).toBe(false)
    })
  })

  describe("findUp", () => {
    it("finds file in current directory", async () => {
      await fs.writeFile(path.join(testDir, "marker.txt"), "test")

      const results = await Filesystem.findUp("marker.txt", testDir)
      expect(results).toContain(path.join(testDir, "marker.txt"))
    })

    it("walks up directories", async () => {
      const subDir = path.join(testDir, "a", "b", "c")
      await fs.mkdir(subDir, { recursive: true })
      await fs.writeFile(path.join(testDir, "target.txt"), "test")

      const results = await Filesystem.findUp("target.txt", subDir)
      expect(results).toContain(path.join(testDir, "target.txt"))
    })

    it("returns empty array when not found", async () => {
      const results = await Filesystem.findUp("nonexistent.txt", testDir)
      expect(results).toEqual([])
    })

    it("returns multiple matches when found at different levels", async () => {
      await fs.mkdir(path.join(testDir, "a"), { recursive: true })
      await fs.mkdir(path.join(testDir, "a", "b"), { recursive: true })
      await fs.writeFile(path.join(testDir, "marker.txt"), "root")
      await fs.writeFile(path.join(testDir, "a", "marker.txt"), "nested")

      const results = await Filesystem.findUp("marker.txt", path.join(testDir, "a", "b"))
      expect(results.length).toBe(2)
      expect(results).toContain(path.join(testDir, "a", "marker.txt"))
      expect(results).toContain(path.join(testDir, "marker.txt"))
    })

    it("handles hidden files", async () => {
      await fs.writeFile(path.join(testDir, ".hidden"), "hidden")

      const results = await Filesystem.findUp(".hidden", testDir)
      expect(results).toContain(path.join(testDir, ".hidden"))
    })
  })

  describe("exists", () => {
    it("returns true for existing file", async () => {
      await fs.writeFile(path.join(testDir, "file.txt"), "content")
      const result = await Filesystem.exists(path.join(testDir, "file.txt"))
      expect(result).toBe(true)
    })

    it("returns true for existing directory", async () => {
      await fs.mkdir(path.join(testDir, "dir"))
      const result = await Filesystem.exists(path.join(testDir, "dir"))
      expect(result).toBe(true)
    })

    it("returns false for missing file", async () => {
      const result = await Filesystem.exists(path.join(testDir, "missing.txt"))
      expect(result).toBe(false)
    })

    it("returns false for missing directory", async () => {
      const result = await Filesystem.exists(path.join(testDir, "missing", "nested"))
      expect(result).toBe(false)
    })
  })

  describe("isDir", () => {
    it("returns true for directories", async () => {
      await fs.mkdir(path.join(testDir, "dir"))
      const result = await Filesystem.isDir(path.join(testDir, "dir"))
      expect(result).toBe(true)
    })

    it("returns false for files", async () => {
      await fs.writeFile(path.join(testDir, "file.txt"), "content")
      const result = await Filesystem.isDir(path.join(testDir, "file.txt"))
      expect(result).toBe(false)
    })

    it("returns false for missing path", async () => {
      const result = await Filesystem.isDir(path.join(testDir, "missing"))
      expect(result).toBe(false)
    })
  })

  describe("readText", () => {
    it("reads file content", async () => {
      await fs.writeFile(path.join(testDir, "content.txt"), "Hello, World!")

      const content = await Filesystem.readText(path.join(testDir, "content.txt"))
      expect(content).toBe("Hello, World!")
    })

    it("throws for missing file", async () => {
      await expect(Filesystem.readText(path.join(testDir, "missing.txt"))).rejects.toThrow()
    })
  })

  describe("write", () => {
    it("writes text content", async () => {
      const filePath = path.join(testDir, "written.txt")
      await Filesystem.write(filePath, "Written content")

      const content = await fs.readFile(filePath, "utf-8")
      expect(content).toBe("Written content")
    })

    it("creates parent directories", async () => {
      const filePath = path.join(testDir, "a", "b", "c", "nested.txt")
      await Filesystem.write(filePath, "nested")

      const exists = await fs
        .access(path.join(testDir, "a", "b", "c", "nested.txt"))
        .then(() => true)
        .catch(() => false)
      expect(exists).toBe(true)
    })
  })

  describe("globUp", () => {
    it("scans glob pattern in each directory", async () => {
      await fs.mkdir(path.join(testDir, "a"), { recursive: true })
      await fs.writeFile(path.join(testDir, "a", "test.txt"), "a")

      const subDir = path.join(testDir, "a", "c")
      await fs.mkdir(subDir, { recursive: true })

      const results = await Filesystem.globUp("*.txt", subDir)
      expect(results).toContain(path.join(testDir, "a", "test.txt"))
    })
  })

  describe("overlaps", () => {
    it("returns true when paths overlap", () => {
      expect(Filesystem.overlaps("/a/b", "/a/b/c")).toBe(true)
      expect(Filesystem.overlaps("/a/b/c", "/a/b")).toBe(true)
    })

    it("returns false when paths don't overlap", () => {
      expect(Filesystem.overlaps("/a/b", "/c/d")).toBe(false)
    })
  })

  describe("resolve", () => {
    it("resolves relative paths", () => {
      const resolved = Filesystem.resolve("./test")
      expect(path.isAbsolute(resolved)).toBe(true)
    })

    it("handles absolute paths", () => {
      const resolved = Filesystem.resolve("/absolute/path")
      // Filesystem.resolve delegates to path.resolve, which is platform
      // specific: on Windows "/absolute/path" resolves against the current
      // drive (e.g. "C:\\absolute\\path"). Compare against the platform oracle
      // and assert the result stays absolute, rather than hardcoding POSIX.
      expect(resolved).toBe(path.resolve("/absolute/path"))
      expect(path.isAbsolute(resolved)).toBe(true)
    })
  })

  describe("stat", () => {
    it("returns stats for existing file", async () => {
      await fs.writeFile(path.join(testDir, "file.txt"), "content")
      const stats = Filesystem.stat(path.join(testDir, "file.txt"))
      expect(stats).toBeDefined()
      expect(stats?.isFile()).toBe(true)
    })

    it("returns undefined for missing file", () => {
      const stats = Filesystem.stat(path.join(testDir, "missing.txt"))
      expect(stats).toBeUndefined()
    })
  })
})
