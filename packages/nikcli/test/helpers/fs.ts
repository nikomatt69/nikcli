import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "fs"
import fs from "fs/promises"
import os from "os"
import path from "path"

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
      // SAFETY: this catch only wraps `fs.rm`, and Node rejects filesystem
      // calls with an `ErrnoException`.
      const code = (error as NodeJS.ErrnoException).code
      if (code !== "EBUSY" && code !== "EPERM" && code !== "ENOTEMPTY") throw error
      if (attempt >= attempts) return
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  }
}

/**
 * Create a directory symlink that an unprivileged Windows user can also create.
 *
 * Symlinks there need SeCreateSymbolicLinkPrivilege — Developer Mode or an
 * elevated shell — so a plain `fs.symlink` throws EPERM on a default developer
 * machine. Junctions need no privilege and are indistinguishable for what these
 * tests assert: `lstat` reports a symbolic link, `realpath` resolves through
 * them, and the target need not exist yet. Junction targets must be absolute,
 * so a relative target is resolved against the link's own directory, which is
 * what `fs.symlink` means by it.
 */
export async function symlinkDir(target: string, linkPath: string): Promise<void> {
  if (process.platform === "win32") {
    await fs.symlink(path.resolve(path.dirname(linkPath), target), linkPath, "junction")
    return
  }
  await fs.symlink(target, linkPath)
}

let fileSymlinkSupport: boolean | undefined

/**
 * Whether this host can create *file* symlinks.
 *
 * Junctions are directory-only, so a test that needs a link to a file has no
 * unprivileged Windows equivalent and can only be skipped there. Probed once
 * rather than assumed from the platform: Developer Mode and elevated shells
 * both make it work, and CI should not silently lose the coverage.
 */
export function canCreateFileSymlinks(): boolean {
  if (fileSymlinkSupport !== undefined) return fileSymlinkSupport
  const probe = mkdtempSync(path.join(os.tmpdir(), "nikcli-symlink-probe-"))
  try {
    writeFileSync(path.join(probe, "target.txt"), "probe")
    symlinkSync(path.join(probe, "target.txt"), path.join(probe, "link.txt"))
    fileSymlinkSupport = true
  } catch {
    fileSymlinkSupport = false
  } finally {
    try {
      rmSync(probe, { recursive: true, force: true })
    } catch {
      // Same Windows lock the remover above tolerates; the OS reclaims temp.
    }
  }
  return fileSymlinkSupport
}
