import fs from "fs/promises"

/**
 * Remove a temp directory a test suite created, tolerating Windows file locks.
 *
 * Windows refuses to delete a file any process still holds open, and most
 * suites here open the session SQLite database without closing it. A plain
 * `fs.rm(recursive)` in `afterAll` then throws EBUSY and fails the whole file
 * on Windows while passing everywhere else. Retry for a moment, then leave the
 * directory to the OS — losing a temp dir is not worth failing a test run over.
 */
export async function removeTestDir(dir: string, attempts = 20): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.rm(dir, { recursive: true, force: true })
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== "EBUSY" && code !== "EPERM" && code !== "ENOTEMPTY") throw error
      if (attempt >= attempts) return
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  }
}
