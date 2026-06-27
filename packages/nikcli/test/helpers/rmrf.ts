import fs from "fs/promises"

/**
 * Recursively remove a path, tolerating transient Windows file-lock errors.
 *
 * Tests that create a real Instance open SQLite/file handles. On Windows those
 * handles are not always released synchronously by `Instance.disposeAll()`, so
 * a bare `fs.rm(dir, { recursive: true, force: true })` in `afterAll`
 * intermittently throws `EBUSY`/`ENOTEMPTY`/`EPERM`/`EACCES` and fails the
 * whole test file even though every assertion passed.
 *
 * This retries with a short backoff to let the OS release handles. Because the
 * target is always a throwaway temp dir, a still-locked path after the final
 * retry is swallowed rather than thrown — the OS reclaims the temp dir later,
 * and failing a test on cleanup is exactly the flake we're removing. Non
 * lock-related errors are still surfaced.
 */
export async function rmrf(target: string, attempts = 12): Promise<void> {
  for (let i = 0; ; i++) {
    try {
      await fs.rm(target, { recursive: true, force: true })
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code
      const lockRelated = code === "EBUSY" || code === "ENOTEMPTY" || code === "EPERM" || code === "EACCES"
      if (!lockRelated) throw error
      if (i >= attempts - 1) return // give up silently — throwaway temp dir
      await new Promise((resolve) => setTimeout(resolve, Math.min(50 * (i + 1), 400)))
    }
  }
}
