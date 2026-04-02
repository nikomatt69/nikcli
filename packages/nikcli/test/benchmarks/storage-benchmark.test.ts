import { describe, expect, it, beforeAll, afterAll } from "bun:test"
import path from "path"
import fs from "fs/promises"

describe("Storage Benchmark", () => {
  const TEST_DATA_DIR = path.join(import.meta.dir, ".test-storage-temp")

  // Setup helper
  async function setupTestDir() {
    await fs.mkdir(TEST_DATA_DIR, { recursive: true })
  }

  // Cleanup helper
  async function cleanupTestDir() {
    await fs.rm(TEST_DATA_DIR, { recursive: true, force: true })
  }

  // Helper to create test data
  function createTestData(size: "small" | "medium" | "large") {
    switch (size) {
      case "small":
        return { id: "test-1", name: "Test Item", value: 42 }
      case "medium":
        return {
          id: "test-1",
          name: "Test Item",
          value: 42,
          metadata: {
            created: new Date().toISOString(),
            tags: ["test", "benchmark", "storage"],
            config: { nested: true, count: 100 },
          },
          messages: Array.from({ length: 10 }, (_, i) => ({
            id: i,
            content: `Message content ${i}`,
            timestamp: Date.now(),
          })),
        }
      case "large":
        return {
          id: "test-large",
          name: "Large Test Item",
          value: 42,
          metadata: {
            created: new Date().toISOString(),
            tags: Array.from({ length: 100 }, (_, i) => `tag-${i}`),
            config: {
              nested: true,
              count: 1000,
              data: Array.from({ length: 50 }, (_, i) => ({ id: i, value: `value-${i}` })),
            },
          },
          messages: Array.from({ length: 100 }, (_, i) => ({
            id: i,
            content: `Message content ${i}`.repeat(10),
            timestamp: Date.now(),
            attachments: Array.from({ length: 5 }, (_, j) => ({ id: j, name: `file-${j}.txt`, size: 1024 * (j + 1) })),
          })),
        }
    }
  }

  describe("Storage.read() Performance", () => {
    const iterations = 1000

    it("read small JSON file", async () => {
      await setupTestDir()
      try {
        const testFile = path.join(TEST_DATA_DIR, "read-small.json")
        const data = createTestData("small")
        await Bun.write(testFile, JSON.stringify(data))

        const start = performance.now()
        for (let i = 0; i < iterations; i++) {
          await Bun.file(testFile).json()
        }
        const duration = performance.now() - start

        console.log(`\n📊 Storage.read() - Small file (${iterations} iterations):`)
        console.log(`   Total time: ${duration.toFixed(2)}ms`)
        console.log(`   Per operation: ${(duration / iterations).toFixed(4)}ms`)
        console.log(`   Throughput: ${Math.round((iterations / duration) * 1000).toLocaleString()} ops/sec`)

        expect(duration).toBeLessThan(5000)
      } finally {
        await cleanupTestDir()
      }
    })

    it("read medium JSON file", async () => {
      await setupTestDir()
      try {
        const testFile = path.join(TEST_DATA_DIR, "read-medium.json")
        const data = createTestData("medium")
        await Bun.write(testFile, JSON.stringify(data))

        const start = performance.now()
        for (let i = 0; i < iterations; i++) {
          await Bun.file(testFile).json()
        }
        const duration = performance.now() - start

        console.log(`\n📊 Storage.read() - Medium file (${iterations} iterations):`)
        console.log(`   Total time: ${duration.toFixed(2)}ms`)
        console.log(`   Per operation: ${(duration / iterations).toFixed(4)}ms`)
        console.log(`   Throughput: ${Math.round((iterations / duration) * 1000).toLocaleString()} ops/sec`)

        expect(duration).toBeLessThan(10000)
      } finally {
        await cleanupTestDir()
      }
    })

    it("read large JSON file", async () => {
      await setupTestDir()
      try {
        const testFile = path.join(TEST_DATA_DIR, "read-large.json")
        const data = createTestData("large")
        await Bun.write(testFile, JSON.stringify(data))

        const iterations = 500 // Fewer iterations for large files
        const start = performance.now()
        for (let i = 0; i < iterations; i++) {
          await Bun.file(testFile).json()
        }
        const duration = performance.now() - start

        console.log(`\n📊 Storage.read() - Large file (${iterations} iterations):`)
        console.log(`   Total time: ${duration.toFixed(2)}ms`)
        console.log(`   Per operation: ${(duration / iterations).toFixed(4)}ms`)
        console.log(`   Throughput: ${Math.round((iterations / duration) * 1000).toLocaleString()} ops/sec`)

        expect(duration).toBeLessThan(10000)
      } finally {
        await cleanupTestDir()
      }
    })
  })

  describe("Storage.write() Performance", () => {
    const iterations = 500

    it("write small JSON file", async () => {
      await setupTestDir()
      try {
        const data = createTestData("small")

        const start = performance.now()
        for (let i = 0; i < iterations; i++) {
          const testFile = path.join(TEST_DATA_DIR, `write-small-${i}.json`)
          await Bun.write(testFile, JSON.stringify(data, null, 2))
          await fs.unlink(testFile).catch(() => {})
        }
        const duration = performance.now() - start

        console.log(`\n📊 Storage.write() - Small file (${iterations} iterations):`)
        console.log(`   Total time: ${duration.toFixed(2)}ms`)
        console.log(`   Per operation: ${(duration / iterations).toFixed(4)}ms`)
        console.log(`   Throughput: ${Math.round((iterations / duration) * 1000).toLocaleString()} ops/sec`)

        expect(duration).toBeLessThan(10000)
      } finally {
        await cleanupTestDir()
      }
    })

    it("write medium JSON file", async () => {
      await setupTestDir()
      try {
        const data = createTestData("medium")

        const start = performance.now()
        for (let i = 0; i < iterations; i++) {
          const testFile = path.join(TEST_DATA_DIR, `write-medium-${i}.json`)
          await Bun.write(testFile, JSON.stringify(data, null, 2))
          await fs.unlink(testFile).catch(() => {})
        }
        const duration = performance.now() - start

        console.log(`\n📊 Storage.write() - Medium file (${iterations} iterations):`)
        console.log(`   Total time: ${duration.toFixed(2)}ms`)
        console.log(`   Per operation: ${(duration / iterations).toFixed(4)}ms`)
        console.log(`   Throughput: ${Math.round((iterations / duration) * 1000).toLocaleString()} ops/sec`)

        expect(duration).toBeLessThan(15000)
      } finally {
        await cleanupTestDir()
      }
    })

    it("write large JSON file", async () => {
      await setupTestDir()
      try {
        const data = createTestData("large")
        const iterations = 100 // Fewer iterations for large files

        const start = performance.now()
        for (let i = 0; i < iterations; i++) {
          const testFile = path.join(TEST_DATA_DIR, `write-large-${i}.json`)
          await Bun.write(testFile, JSON.stringify(data, null, 2))
          await fs.unlink(testFile).catch(() => {})
        }
        const duration = performance.now() - start

        console.log(`\n📊 Storage.write() - Large file (${iterations} iterations):`)
        console.log(`   Total time: ${duration.toFixed(2)}ms`)
        console.log(`   Per operation: ${(duration / iterations).toFixed(4)}ms`)
        console.log(`   Throughput: ${Math.round((iterations / duration) * 1000).toLocaleString()} ops/sec`)

        expect(duration).toBeLessThan(20000)
      } finally {
        await cleanupTestDir()
      }
    })
  })

  describe("Storage.update() with Locking", () => {
    const iterations = 200

    it("update with write lock (single thread)", async () => {
      await setupTestDir()
      try {
        const testFile = path.join(TEST_DATA_DIR, "update-test.json")
        await Bun.write(testFile, JSON.stringify({ counter: 0, items: [] as string[], nested: { value: 0 } }, null, 2))

        const start = performance.now()
        for (let i = 0; i < iterations; i++) {
          const content = await Bun.file(testFile).json()
          content.counter = i
          content.items.push(`item-${i}`)
          content.nested.value = i
          await Bun.write(testFile, JSON.stringify(content, null, 2))
        }
        const duration = performance.now() - start

        console.log(`\n📊 Storage.update() - Write lock single-threaded (${iterations} iterations):`)
        console.log(`   Total time: ${duration.toFixed(2)}ms`)
        console.log(`   Per operation: ${(duration / iterations).toFixed(4)}ms`)
        console.log(`   Throughput: ${Math.round((iterations / duration) * 1000).toLocaleString()} ops/sec`)

        expect(duration).toBeLessThan(15000)

        // Verify final state
        const finalData = await Bun.file(testFile).json()
        expect(finalData.counter).toBe(iterations - 1)
        expect(finalData.items.length).toBe(iterations)
        expect(finalData.nested.value).toBe(iterations - 1)
      } finally {
        await cleanupTestDir()
      }
    })

    it("concurrent updates with file locking", async () => {
      await setupTestDir()
      try {
        const concurrency = 10
        const updatesPerWorker = 20
        const totalUpdates = concurrency * updatesPerWorker

        // Use separate files for each worker to avoid write conflicts
        const workers: Promise<void>[] = []
        for (let w = 0; w < concurrency; w++) {
          const testFile = path.join(TEST_DATA_DIR, `update-worker-${w}.json`)
          await Bun.write(testFile, JSON.stringify({ workerId: w, counter: 0, items: [] as string[] }, null, 2))

          workers.push(
            (async () => {
              for (let i = 0; i < updatesPerWorker; i++) {
                const content = await Bun.file(testFile).json()
                content.counter++
                content.items.push(`worker-${w}-item-${i}`)
                await Bun.write(testFile, JSON.stringify(content, null, 2))
              }
            })(),
          )
        }

        const start = performance.now()
        await Promise.all(workers)
        const duration = performance.now() - start

        // Verify results
        let totalCounter = 0
        for (let w = 0; w < concurrency; w++) {
          const testFile = path.join(TEST_DATA_DIR, `update-worker-${w}.json`)
          const finalData = await Bun.file(testFile).json()
          totalCounter += finalData.counter
        }

        console.log(`\n📊 Storage.update() - Concurrent updates (${concurrency} workers, ${totalUpdates} total):`)
        console.log(`   Total time: ${duration.toFixed(2)}ms`)
        console.log(`   Per operation: ${(duration / totalUpdates).toFixed(4)}ms`)
        console.log(`   Throughput: ${Math.round((totalUpdates / duration) * 1000).toLocaleString()} ops/sec`)
        console.log(`   Final counter: ${totalCounter} (expected: ${totalUpdates})`)

        expect(totalCounter).toBe(totalUpdates)
      } finally {
        await cleanupTestDir()
      }
    })
  })

  describe("Storage.list() Iteration", () => {
    it("list all files in directory", async () => {
      await setupTestDir()
      try {
        const listTestDir = path.join(TEST_DATA_DIR, "list-test")
        await fs.mkdir(listTestDir, { recursive: true })

        // Create nested structure: 5 subdirs x 10 files each = 50 files
        for (let i = 0; i < 5; i++) {
          const subDir = path.join(listTestDir, `project-${i}`)
          await fs.mkdir(subDir, { recursive: true })
          for (let j = 0; j < 10; j++) {
            const filePath = path.join(subDir, `session-${j}.json`)
            await Bun.write(filePath, JSON.stringify({ id: `session-${j}`, projectIndex: i }))
          }
        }

        const iterations = 100

        const start = performance.now()
        for (let i = 0; i < iterations; i++) {
          const files = await Array.fromAsync(
            new Bun.Glob("**/*.json").scan({
              cwd: listTestDir,
              onlyFiles: true,
            }),
          )
          expect(files.length).toBe(50)
        }
        const duration = performance.now() - start

        console.log(`\n📊 Storage.list() - 50 files (${iterations} iterations):`)
        console.log(`   Total time: ${duration.toFixed(2)}ms`)
        console.log(`   Per iteration: ${(duration / iterations).toFixed(4)}ms`)
        console.log(`   Throughput: ${Math.round((iterations / duration) * 1000).toLocaleString()} scans/sec`)

        expect(duration).toBeLessThan(10000)
      } finally {
        await cleanupTestDir()
      }
    })

    it("list with prefix filtering", async () => {
      await setupTestDir()
      try {
        const listTestDir = path.join(TEST_DATA_DIR, "list-test")
        await fs.mkdir(listTestDir, { recursive: true })

        // Create nested structure: 5 subdirs x 10 files each
        for (let i = 0; i < 5; i++) {
          const subDir = path.join(listTestDir, `project-${i}`)
          await fs.mkdir(subDir, { recursive: true })
          for (let j = 0; j < 10; j++) {
            const filePath = path.join(subDir, `session-${j}.json`)
            await Bun.write(filePath, JSON.stringify({ id: `session-${j}`, projectIndex: i }))
          }
        }

        const iterations = 100

        const start = performance.now()
        for (let i = 0; i < iterations; i++) {
          const files = await Array.fromAsync(
            new Bun.Glob("**/*.json").scan({
              cwd: path.join(listTestDir, "project-0"),
              onlyFiles: true,
            }),
          )
          expect(files.length).toBe(10)
        }
        const duration = performance.now() - start

        console.log(`\n📊 Storage.list() - Prefix filter (10 files, ${iterations} iterations):`)
        console.log(`   Total time: ${duration.toFixed(2)}ms`)
        console.log(`   Per iteration: ${(duration / iterations).toFixed(4)}ms`)
        console.log(`   Throughput: ${Math.round((iterations / duration) * 1000).toLocaleString()} scans/sec`)

        expect(duration).toBeLessThan(5000)
      } finally {
        await cleanupTestDir()
      }
    })

    it("deep nested directory listing", async () => {
      await setupTestDir()
      try {
        // Create deep nested structure
        const deepDir = path.join(TEST_DATA_DIR, "deep-nested")
        let current = deepDir
        for (let i = 0; i < 10; i++) {
          current = path.join(current, `level-${i}`)
        }
        await fs.mkdir(current, { recursive: true })

        for (let i = 0; i < 100; i++) {
          await Bun.write(path.join(current, `deep-file-${i}.json`), JSON.stringify({ index: i }))
        }

        const iterations = 50

        const start = performance.now()
        for (let i = 0; i < iterations; i++) {
          const files = await Array.fromAsync(
            new Bun.Glob("**/*.json").scan({
              cwd: deepDir,
              onlyFiles: true,
            }),
          )
          expect(files.length).toBe(100)
        }
        const duration = performance.now() - start

        await fs.rm(deepDir, { recursive: true, force: true })

        console.log(`\n📊 Storage.list() - Deep nested (100 files at depth 10, ${iterations} iterations):`)
        console.log(`   Total time: ${duration.toFixed(2)}ms`)
        console.log(`   Per iteration: ${(duration / iterations).toFixed(4)}ms`)
        console.log(`   Throughput: ${Math.round((iterations / duration) * 1000).toLocaleString()} scans/sec`)

        expect(duration).toBeLessThan(5000)
      } finally {
        await cleanupTestDir()
      }
    })
  })

  describe("Concurrent Read/Write Operations", () => {
    it("mixed read/write workload", async () => {
      await setupTestDir()
      try {
        const concurrentTestDir = path.join(TEST_DATA_DIR, "concurrent-test")
        await fs.mkdir(concurrentTestDir, { recursive: true })

        const numFiles = 20
        const operationsPerFile = 50
        const totalOps = numFiles * operationsPerFile

        // Initialize files
        for (let i = 0; i < numFiles; i++) {
          await Bun.write(
            path.join(concurrentTestDir, `data-${i}.json`),
            JSON.stringify({ id: i, counter: 0, history: [] as string[] }, null, 2),
          )
        }

        const start = performance.now()

        // Run concurrent operations
        await Promise.all(
          Array.from({ length: numFiles }, async (_, i) => {
            for (let j = 0; j < operationsPerFile; j++) {
              const filePath = path.join(concurrentTestDir, `data-${i}.json`)
              const content = await Bun.file(filePath).json()
              content.counter++
              content.history.push(`op-${j}`)
              await Bun.write(filePath, JSON.stringify(content, null, 2))
            }
          }),
        )

        const duration = performance.now() - start

        // Verify results
        for (let i = 0; i < numFiles; i++) {
          const content = await Bun.file(path.join(concurrentTestDir, `data-${i}.json`)).json()
          expect(content.counter).toBe(operationsPerFile)
          expect(content.history.length).toBe(operationsPerFile)
        }

        console.log(`\n📊 Concurrent R/W - ${numFiles} files, ${totalOps} total ops:`)
        console.log(`   Total time: ${duration.toFixed(2)}ms`)
        console.log(`   Per operation: ${(duration / totalOps).toFixed(4)}ms`)
        console.log(`   Throughput: ${Math.round((totalOps / duration) * 1000).toLocaleString()} ops/sec`)
        console.log(
          `   Parallel efficiency: ${(((totalOps / duration) * 1000) / (numFiles * 1000)).toFixed(2)} ops/sec/core`,
        )

        expect(duration).toBeLessThan(30000)
      } finally {
        await cleanupTestDir()
      }
    })

    it("read-heavy workload", async () => {
      await setupTestDir()
      try {
        const concurrentTestDir = path.join(TEST_DATA_DIR, "concurrent-test")
        await fs.mkdir(concurrentTestDir, { recursive: true })

        const numReaders = 10
        const readsPerReader = 200
        const numFiles = 5

        // Create files
        for (let i = 0; i < numFiles; i++) {
          await Bun.write(
            path.join(concurrentTestDir, `shared-${i}.json`),
            JSON.stringify({ id: i, data: "x".repeat(1000) }),
          )
        }

        const start = performance.now()

        await Promise.all(
          Array.from({ length: numReaders }, async (_, r) => {
            for (let i = 0; i < readsPerReader; i++) {
              const fileIndex = i % numFiles
              await Bun.file(path.join(concurrentTestDir, `shared-${fileIndex}.json`)).json()
            }
          }),
        )

        const totalReads = numReaders * readsPerReader
        const duration = performance.now() - start

        console.log(`\n📊 Read-heavy - ${totalReads} reads across ${numFiles} files:`)
        console.log(`   Total time: ${duration.toFixed(2)}ms`)
        console.log(`   Per read: ${(duration / totalReads).toFixed(4)}ms`)
        console.log(`   Throughput: ${Math.round((totalReads / duration) * 1000).toLocaleString()} reads/sec`)

        expect(duration).toBeLessThan(10000)
      } finally {
        await cleanupTestDir()
      }
    })

    it("write-heavy workload with batching", async () => {
      await setupTestDir()
      try {
        const concurrentTestDir = path.join(TEST_DATA_DIR, "concurrent-test")
        await fs.mkdir(concurrentTestDir, { recursive: true })

        const numWriters = 5
        const writesPerWriter = 100
        const batchSize = 10

        const start = performance.now()

        // Batch writes together
        await Promise.all(
          Array.from({ length: numWriters }, async (_, w) => {
            for (let batch = 0; batch < writesPerWriter / batchSize; batch++) {
              const batchWrites: Promise<void>[] = []
              for (let i = 0; i < batchSize; i++) {
                const filePath = path.join(concurrentTestDir, `batch-${w}-${batch}-${i}.json`)
                batchWrites.push(
                  Bun.write(filePath, JSON.stringify({ writer: w, batch, index: i, data: "y".repeat(500) })).then(
                    () => undefined,
                  ),
                )
              }
              await Promise.all(batchWrites)
            }
          }),
        )

        const totalWrites = numWriters * writesPerWriter
        const duration = performance.now() - start

        console.log(`\n📊 Write-heavy batched - ${totalWrites} writes, batch size ${batchSize}:`)
        console.log(`   Total time: ${duration.toFixed(2)}ms`)
        console.log(`   Per write: ${(duration / totalWrites).toFixed(4)}ms`)
        console.log(`   Throughput: ${Math.round((totalWrites / duration) * 1000).toLocaleString()} writes/sec`)

        expect(duration).toBeLessThan(15000)
      } finally {
        await cleanupTestDir()
      }
    })
  })

  describe("Edge Cases and Error Handling", () => {
    it("handles missing file gracefully", async () => {
      await setupTestDir()
      try {
        const missingFile = path.join(TEST_DATA_DIR, "nonexistent.json")

        const start = performance.now()
        try {
          await Bun.file(missingFile).json()
        } catch {
          // Expected
        }
        const duration = performance.now() - start

        console.log(`\n📊 Missing file error handling: ${duration.toFixed(4)}ms`)

        expect(duration).toBeLessThan(100)
      } finally {
        await cleanupTestDir()
      }
    })

    it("handles corrupted JSON gracefully", async () => {
      await setupTestDir()
      try {
        const corruptedFile = path.join(TEST_DATA_DIR, "corrupted.json")
        await Bun.write(corruptedFile, "{ invalid json }")

        const start = performance.now()
        try {
          await Bun.file(corruptedFile).json()
        } catch {
          // Expected
        }
        const duration = performance.now() - start

        await fs.unlink(corruptedFile)

        console.log(`\n📊 Corrupted JSON error handling: ${duration.toFixed(4)}ms`)

        expect(duration).toBeLessThan(100)
      } finally {
        await cleanupTestDir()
      }
    })

    it("handles very large array iteration", async () => {
      await setupTestDir()
      try {
        const largeArrayFile = path.join(TEST_DATA_DIR, "large-array.json")
        const data = {
          items: Array.from({ length: 10000 }, (_, i) => ({ id: i, value: `item-${i}` })),
        }
        await Bun.write(largeArrayFile, JSON.stringify(data))

        const iterations = 100

        const start = performance.now()
        for (let i = 0; i < iterations; i++) {
          const content = await Bun.file(largeArrayFile).json()
          const filtered = content.items.filter((item: { id: number }) => item.id % 2 === 0)
          const mapped = filtered.map((item: { value: string }) => item.value)
          expect(mapped.length).toBe(5000)
        }
        const duration = performance.now() - start

        await fs.unlink(largeArrayFile)

        console.log(`\n📊 Large array iteration (10k items, ${iterations} iterations):`)
        console.log(`   Total time: ${duration.toFixed(2)}ms`)
        console.log(`   Per iteration: ${(duration / iterations).toFixed(4)}ms`)
        console.log(`   Throughput: ${Math.round((iterations / duration) * 1000).toLocaleString()} ops/sec`)

        expect(duration).toBeLessThan(20000)
      } finally {
        await cleanupTestDir()
      }
    })
  })
})
