import { describe, expect, it } from "bun:test"
import { Lock } from "@/util/lock"

describe("Lock", () => {
  describe("read lock", () => {
    it("acquires read lock immediately when no writers", async () => {
      const lock = await Lock.read("test-key")
      expect(lock).toBeDefined()
      expect(typeof lock[Symbol.dispose]).toBe("function")
    })

    it("releases read lock on dispose", async () => {
      const lock = await Lock.read("test-key")
      lock[Symbol.dispose]()
      // Lock should be cleaned up - next read should succeed
      const lock2 = await Lock.read("test-key")
      expect(lock2).toBeDefined()
      lock2[Symbol.dispose]()
    })

    it("allows multiple concurrent readers", async () => {
      const lock1 = await Lock.read("concurrent-readers")
      const lock2 = await Lock.read("concurrent-readers")
      const lock3 = await Lock.read("concurrent-readers")

      expect(lock1).toBeDefined()
      expect(lock2).toBeDefined()
      expect(lock3).toBeDefined()

      lock1[Symbol.dispose]()
      lock2[Symbol.dispose]()
      lock3[Symbol.dispose]()
    })

    it("queues readers when writer active", async () => {
      const writeLock = await Lock.write("queue-test")

      // This should queue
      const readPromise = Lock.read("queue-test")

      // Release write lock
      writeLock[Symbol.dispose]()

      // Now read should succeed
      const readLock = await readPromise
      expect(readLock).toBeDefined()
      readLock[Symbol.dispose]()
    })
  })

  describe("write lock", () => {
    it("acquires write lock immediately when no readers", async () => {
      const lock = await Lock.write("write-test")
      expect(lock).toBeDefined()
      expect(typeof lock[Symbol.dispose]).toBe("function")
    })

    it("releases write lock on dispose", async () => {
      const key = "write-test-" + Date.now()
      const lock = await Lock.write(key)
      lock[Symbol.dispose]()

      // Should be able to acquire again
      const lock2 = await Lock.write(key)
      expect(lock2).toBeDefined()
      lock2[Symbol.dispose]()
    })

    it("blocks when another writer is active", async () => {
      const lock1 = await Lock.write("writer-conflict")

      // This should queue
      const lock2Promise = Lock.write("writer-conflict")

      // Release first lock
      lock1[Symbol.dispose]()

      // Now second lock should be acquired
      const lock2 = await lock2Promise
      expect(lock2).toBeDefined()
      lock2[Symbol.dispose]()
    })

    it("blocks when readers are active", async () => {
      const readLock = await Lock.read("reader-block")

      // This should queue
      const writeLockPromise = Lock.write("reader-block")

      // Release read lock
      readLock[Symbol.dispose]()

      // Write lock should now be acquired
      const writeLock = await writeLockPromise
      expect(writeLock).toBeDefined()
      writeLock[Symbol.dispose]()
    })
  })

  describe("mixed operations", () => {
    it("handles read-write-read sequence", async () => {
      const read1 = await Lock.read("mixed-test")
      read1[Symbol.dispose]()

      const write = await Lock.write("mixed-test")
      write[Symbol.dispose]()

      const read2 = await Lock.read("mixed-test")
      read2[Symbol.dispose]()
    })

    it("handles write-read-write sequence", async () => {
      const write1 = await Lock.write("mixed-test-2")
      write1[Symbol.dispose]()

      const read = await Lock.read("mixed-test-2")
      read[Symbol.dispose]()

      const write2 = await Lock.write("mixed-test-2")
      write2[Symbol.dispose]()
    })

    it("handles multiple readers then writer", async () => {
      const locks: Disposable[] = []

      // Acquire multiple readers
      for (let i = 0; i < 5; i++) {
        locks.push(await Lock.read("multi-reader"))
      }

      // Release all
      for (const lock of locks) {
        lock[Symbol.dispose]()
      }

      // Writer should now be able to acquire
      const writerLock = await Lock.write("multi-reader")
      writerLock[Symbol.dispose]()
    })
  })

  describe("cleanup", () => {
    it("removes lock state when empty", async () => {
      const lock = await Lock.read("cleanup-test")
      lock[Symbol.dispose]()

      // After releasing, the lock should be cleaned up
      // We can verify by checking that a new lock is independent
      const lock2 = await Lock.read("cleanup-test")
      lock2[Symbol.dispose]()
    })

    it("handles rapid acquire/release cycles", async () => {
      for (let i = 0; i < 100; i++) {
        const lock = await Lock.read("rapid-test")
        lock[Symbol.dispose]()
      }
    })
  })

  describe("dispose behavior", () => {
    it("Symbol.dispose returns undefined", async () => {
      const lock = await Lock.read("dispose-return")
      expect(lock[Symbol.dispose]()).toBeUndefined()
    })

    it("can dispose multiple times", async () => {
      const lock = await Lock.read("dispose-multiple")
      lock[Symbol.dispose]()

      // Second dispose should not throw
      expect(() => lock[Symbol.dispose]()).not.toThrow()
    })

    it("dispose after write release allows new write", async () => {
      const lock = await Lock.write("dispose-write")
      lock[Symbol.dispose]()

      const newLock = await Lock.write("dispose-write")
      expect(newLock).toBeDefined()
      newLock[Symbol.dispose]()
    })
  })

  describe("edge cases", () => {
    it("handles empty key", async () => {
      const lock = await Lock.read("")
      expect(lock).toBeDefined()
      lock[Symbol.dispose]()
    })

    it("handles special characters in key", async () => {
      const lock = await Lock.read("key/with/special:chars")
      expect(lock).toBeDefined()
      lock[Symbol.dispose]()
    })

    it("handles unicode in key", async () => {
      const lock = await Lock.read("key-日本語-emoji-🔐")
      expect(lock).toBeDefined()
      lock[Symbol.dispose]()
    })

    it("handles very long key", async () => {
      const longKey = "key-" + "a".repeat(1000)
      const lock = await Lock.read(longKey)
      expect(lock).toBeDefined()
      lock[Symbol.dispose]()
    })
  })
})
