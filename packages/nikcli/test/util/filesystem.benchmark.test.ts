import { describe, expect, it, beforeEach, afterEach } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { Filesystem } from "@/util/filesystem"
import { recordBenchmark } from "../benchmarks/runner"

describe("Filesystem Benchmark", () => {
  let testDir: string

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-filesystem-bench-"))
  })

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true })
  })

  describe("exists performance", () => {
    it("check existing file", async () => {
      await fs.writeFile(path.join(testDir, "test.txt"), "content")

      const iterations = 10000

      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        await Filesystem.exists(path.join(testDir, "test.txt"))
      }
      const elapsed = performance.now() - start

      console.log(`\n📊 Filesystem.exists on existing file (${iterations} iterations):`)
      console.log(`   Total: ${elapsed.toFixed(2)}ms`)
      console.log(`   Per op: ${(elapsed / iterations).toFixed(4)}ms`)

      recordBenchmark({
        suite: "util",
        module: "filesystem",
        scenario: "exists on existing file",
        iterations,
        value: elapsed,
        unit: "ms",
      })

      expect(elapsed).toBeLessThan(10000)
    })

    it("check missing file", async () => {
      const iterations = 10000

      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        await Filesystem.exists(path.join(testDir, "missing.txt"))
      }
      const elapsed = performance.now() - start

      console.log(`\n📊 Filesystem.exists on missing file (${iterations} iterations):`)
      console.log(`   Total: ${elapsed.toFixed(2)}ms`)
      console.log(`   Per op: ${(elapsed / iterations).toFixed(4)}ms`)

      recordBenchmark({
        suite: "util",
        module: "filesystem",
        scenario: "exists on missing file",
        iterations,
        value: elapsed,
        unit: "ms",
      })

      expect(elapsed).toBeLessThan(10000)
    })
  })

  describe("isDir performance", () => {
    it("check existing directory", async () => {
      await fs.mkdir(path.join(testDir, "dir"))

      const iterations = 10000

      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        await Filesystem.isDir(path.join(testDir, "dir"))
      }
      const elapsed = performance.now() - start

      console.log(`\n📊 Filesystem.isDir on existing directory (${iterations} iterations):`)
      console.log(`   Total: ${elapsed.toFixed(2)}ms`)
      console.log(`   Per op: ${(elapsed / iterations).toFixed(4)}ms`)

      recordBenchmark({
        suite: "util",
        module: "filesystem",
        scenario: "isDir on existing directory",
        iterations,
        value: elapsed,
        unit: "ms",
      })

      expect(elapsed).toBeLessThan(10000)
    })
  })

  describe("contains performance", () => {
    it("path containment check", () => {
      const iterations = 100000

      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        Filesystem.contains("/home/user/project", "/home/user/project/src/file.ts")
      }
      const elapsed = performance.now() - start

      console.log(`\n📊 Filesystem.contains (${iterations} iterations):`)
      console.log(`   Total: ${elapsed.toFixed(2)}ms`)
      console.log(`   Per op: ${(elapsed / iterations).toFixed(4)}ms`)
      console.log(`   Ops/sec: ${((iterations / elapsed) * 1000).toFixed(0)}`)

      recordBenchmark({
        suite: "util",
        module: "filesystem",
        scenario: "contains contained path",
        iterations,
        value: elapsed,
        unit: "ms",
      })

      expect(elapsed).toBeLessThan(1000)
    })

    it("non-contained paths", async () => {
      const iterations = 100000

      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        Filesystem.contains("/home/user", "/var/www")
      }
      const elapsed = performance.now() - start

      console.log(`\n📊 Filesystem.contains (non-contained) (${iterations} iterations):`)
      console.log(`   Total: ${elapsed.toFixed(2)}ms`)
      console.log(`   Per op: ${(elapsed / iterations).toFixed(4)}ms`)

      recordBenchmark({
        suite: "util",
        module: "filesystem",
        scenario: "contains non-contained path",
        iterations,
        value: elapsed,
        unit: "ms",
      })

      expect(elapsed).toBeLessThan(1000)
    })
  })

  describe("findUp performance", () => {
    it("find file in current directory", async () => {
      await fs.writeFile(path.join(testDir, "marker.txt"), "test")

      const iterations = 10000

      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        await Filesystem.findUp(testDir, "marker.txt")
      }
      const elapsed = performance.now() - start

      console.log(`\n📊 Filesystem.findUp (found immediately) (${iterations} iterations):`)
      console.log(`   Total: ${elapsed.toFixed(2)}ms`)
      console.log(`   Per op: ${(elapsed / iterations).toFixed(4)}ms`)

      recordBenchmark({
        suite: "util",
        module: "filesystem",
        scenario: "findUp immediate hit",
        iterations,
        value: elapsed,
        unit: "ms",
      })

      expect(elapsed).toBeLessThan(5000)
    })

    it("find file in parent directory", async () => {
      await fs.writeFile(path.join(testDir, "target.txt"), "test")
      const subDir = path.join(testDir, "a", "b", "c")
      await fs.mkdir(subDir, { recursive: true })

      const iterations = 10000

      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        await Filesystem.findUp(subDir, "target.txt")
      }
      const elapsed = performance.now() - start

      console.log(`\n📊 Filesystem.findUp (walks up 3 levels) (${iterations} iterations):`)
      console.log(`   Total: ${elapsed.toFixed(2)}ms`)
      console.log(`   Per op: ${(elapsed / iterations).toFixed(4)}ms`)

      recordBenchmark({
        suite: "util",
        module: "filesystem",
        scenario: "findUp walks up 3 levels",
        iterations,
        value: elapsed,
        unit: "ms",
      })

      expect(elapsed).toBeLessThan(10000)
    })

    it("file not found", async () => {
      const subDir = path.join(testDir, "a", "b", "c")
      await fs.mkdir(subDir, { recursive: true })

      const iterations = 5000

      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        await Filesystem.findUp(subDir, "nonexistent.txt")
      }
      const elapsed = performance.now() - start

      console.log(`\n📊 Filesystem.findUp (not found, walks to root) (${iterations} iterations):`)
      console.log(`   Total: ${elapsed.toFixed(2)}ms`)
      console.log(`   Per op: ${(elapsed / iterations).toFixed(4)}ms`)

      recordBenchmark({
        suite: "util",
        module: "filesystem",
        scenario: "findUp not found walks to root",
        iterations,
        value: elapsed,
        unit: "ms",
      })

      expect(elapsed).toBeLessThan(10000)
    })
  })

  describe("read performance", () => {
    it("read small text file", async () => {
      await fs.writeFile(path.join(testDir, "small.txt"), "Hello, World!")

      const iterations = 1000

      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        await Filesystem.readText(path.join(testDir, "small.txt"))
      }
      const elapsed = performance.now() - start

      console.log(`\n📊 Filesystem.readText small text (${iterations} iterations):`)
      console.log(`   Total: ${elapsed.toFixed(2)}ms`)
      console.log(`   Per op: ${(elapsed / iterations).toFixed(4)}ms`)

      recordBenchmark({
        suite: "util",
        module: "filesystem",
        scenario: "readText small file",
        iterations,
        value: elapsed,
        unit: "ms",
      })

      expect(elapsed).toBeLessThan(10000)
    })

    it("read larger text file", async () => {
      const content = "x".repeat(10000)
      await fs.writeFile(path.join(testDir, "large.txt"), content)

      const iterations = 500

      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        await Filesystem.readText(path.join(testDir, "large.txt"))
      }
      const elapsed = performance.now() - start

      console.log(`\n📊 Filesystem.readText 10KB text (${iterations} iterations):`)
      console.log(`   Total: ${elapsed.toFixed(2)}ms`)
      console.log(`   Per op: ${(elapsed / iterations).toFixed(4)}ms`)

      recordBenchmark({
        suite: "util",
        module: "filesystem",
        scenario: "readText 10KB file",
        iterations,
        value: elapsed,
        unit: "ms",
      })

      expect(elapsed).toBeLessThan(10000)
    })
  })

  describe("write performance", () => {
    it("write small text file", async () => {
      const iterations = 500

      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        await Filesystem.write(path.join(testDir, `file-${i}.txt`), "content")
      }
      const elapsed = performance.now() - start

      console.log(`\n📊 Filesystem.write small text (${iterations} iterations):`)
      console.log(`   Total: ${elapsed.toFixed(2)}ms`)
      console.log(`   Per op: ${(elapsed / iterations).toFixed(4)}ms`)

      recordBenchmark({
        suite: "util",
        module: "filesystem",
        scenario: "write small file",
        iterations,
        value: elapsed,
        unit: "ms",
      })

      expect(elapsed).toBeLessThan(10000)
    })

    it("write to same file repeatedly", async () => {
      const filePath = path.join(testDir, "repeated.txt")

      const iterations = 1000

      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        await Filesystem.write(filePath, `content-${i}`)
      }
      const elapsed = performance.now() - start

      console.log(`\n📊 Filesystem.write to same file (${iterations} iterations):`)
      console.log(`   Total: ${elapsed.toFixed(2)}ms`)
      console.log(`   Per op: ${(elapsed / iterations).toFixed(4)}ms`)

      recordBenchmark({
        suite: "util",
        module: "filesystem",
        scenario: "write same file repeatedly",
        iterations,
        value: elapsed,
        unit: "ms",
      })

      expect(elapsed).toBeLessThan(10000)
    })
  })

  describe("globUp performance", () => {
    it("globUp with few files", async () => {
      for (let i = 0; i < 10; i++) {
        await fs.writeFile(path.join(testDir, `file${i}.txt`), `content${i}`)
      }

      const iterations = 100

      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        await Filesystem.globUp("*.txt", testDir)
      }
      const elapsed = performance.now() - start

      console.log(`\n📊 Filesystem.globUp (10 files) (${iterations} iterations):`)
      console.log(`   Total: ${elapsed.toFixed(2)}ms`)
      console.log(`   Per op: ${(elapsed / iterations).toFixed(4)}ms`)

      recordBenchmark({
        suite: "util",
        module: "filesystem",
        scenario: "globUp 10 files",
        iterations,
        value: elapsed,
        unit: "ms",
      })

      expect(elapsed).toBeLessThan(10000)
    })

    it("globUp walks up directories", async () => {
      // Create nested structure
      await fs.mkdir(path.join(testDir, "a", "b"), { recursive: true })
      await fs.writeFile(path.join(testDir, "target.txt"), "root")
      await fs.writeFile(path.join(testDir, "a", "target.txt"), "nested")

      const iterations = 100
      const subDir = path.join(testDir, "a", "b")

      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        await Filesystem.globUp("*.txt", subDir)
      }
      const elapsed = performance.now() - start

      console.log(`\n📊 Filesystem.globUp walks up (${iterations} iterations):`)
      console.log(`   Total: ${elapsed.toFixed(2)}ms`)
      console.log(`   Per op: ${(elapsed / iterations).toFixed(4)}ms`)

      recordBenchmark({
        suite: "util",
        module: "filesystem",
        scenario: "globUp walks up",
        iterations,
        value: elapsed,
        unit: "ms",
      })

      expect(elapsed).toBeLessThan(10000)
    })
  })
})
