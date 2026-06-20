import { mkdtemp, rm } from "fs/promises"
import { tmpdir } from "os"
import path from "path"

/**
 * Build a gzipped tarball of a session working directory so it can be teleported
 * to a remote server. Includes the full `.git` directory plus every non-ignored
 * working-tree file (tracked + untracked), selected via `git ls-files` so that
 * ignored paths like `node_modules` are never even walked — keeping the archive
 * small and the operation fast. For non-git directories it falls back to taring
 * the whole tree minus `node_modules`.
 *
 * Returns the path to a temp `.tar.gz` and a `cleanup()` to remove it, or `null`
 * if the directory does not exist.
 */
export async function createWorkspaceArchive(
  directory: string,
): Promise<{ path: string; cleanup: () => Promise<void> } | null> {
  try {
    const { stat } = await import("fs/promises")
    if (!(await stat(directory)).isDirectory()) return null
  } catch {
    return null
  }

  const work = await mkdtemp(path.join(tmpdir(), "nikcli-teleport-"))
  const archivePath = path.join(work, "workspace.tar.gz")
  const cleanup = () => rm(work, { recursive: true, force: true }).catch(() => undefined)

  const root = (await gitTopLevel(directory)) ?? directory
  const isGit = root === directory && (await isGitRepo(directory))

  try {
    if (isGit) {
      // Null-separated list of non-ignored working-tree files (tracked + untracked),
      // with the full `.git` directory prepended so history travels along too.
      const listed = await runCapture(
        ["git", "-C", root, "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
        root,
      )
      const listFile = path.join(work, "files.txt")
      const gitEntry = new TextEncoder().encode(".git\0")
      const fileList = new Uint8Array(gitEntry.length + listed.length)
      fileList.set(gitEntry, 0)
      fileList.set(listed, gitEntry.length)
      await Bun.write(listFile, fileList)
      await runOk(["tar", "-czf", archivePath, "--null", "-C", root, "-T", listFile], root)
    } else {
      await runOk(["tar", "-czf", archivePath, "-C", root, "--exclude=node_modules", "--exclude=.DS_Store", "."], root)
    }
  } catch (error) {
    await cleanup()
    throw error
  }

  return { path: archivePath, cleanup }
}

async function isGitRepo(dir: string): Promise<boolean> {
  try {
    const out = await runCaptureText(["git", "-C", dir, "rev-parse", "--is-inside-work-tree"], dir)
    return out.trim() === "true"
  } catch {
    return false
  }
}

async function gitTopLevel(dir: string): Promise<string | null> {
  try {
    const out = await runCaptureText(["git", "-C", dir, "rev-parse", "--show-toplevel"], dir)
    const top = out.trim()
    return top ? path.resolve(top) : null
  } catch {
    return null
  }
}

async function runCapture(cmd: string[], cwd: string): Promise<Uint8Array> {
  const proc = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe" })
  const bytes = new Uint8Array(await new Response(proc.stdout).arrayBuffer())
  const code = await proc.exited
  if (code !== 0) throw new Error(`${cmd[0]} exited with code ${code}`)
  return bytes
}

async function runCaptureText(cmd: string[], cwd: string): Promise<string> {
  return new TextDecoder().decode(await runCapture(cmd, cwd))
}

async function runOk(cmd: string[], cwd: string): Promise<void> {
  const proc = Bun.spawn(cmd, { cwd, stdout: "ignore", stderr: "pipe" })
  const code = await proc.exited
  if (code !== 0) {
    const err = await new Response(proc.stderr).text().catch(() => "")
    throw new Error(`${cmd[0]} failed (${code})${err ? `: ${err.slice(0, 200)}` : ""}`)
  }
}
