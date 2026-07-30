import { mkdtemp, rm } from "fs/promises"
import { tmpdir } from "os"
import path from "path"

/** File extensions skipped by default — binaries/media that aren't needed to keep coding. */
const BINARY_EXTENSIONS = new Set([
  // images
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "tiff",
  "tif",
  "ico",
  "icns",
  "heic",
  "heif",
  "avif",
  // video
  "mp4",
  "mov",
  "avi",
  "mkv",
  "webm",
  "flv",
  "wmv",
  "m4v",
  "mpg",
  "mpeg",
  // audio
  "mp3",
  "wav",
  "flac",
  "ogg",
  "m4a",
  "aac",
  "wma",
  "opus",
  // fonts
  "woff",
  "woff2",
  "ttf",
  "otf",
  "eot",
  // archives
  "zip",
  "tar",
  "gz",
  "tgz",
  "bz2",
  "xz",
  "7z",
  "rar",
  "zst",
  "lz4",
  // compiled / native
  "exe",
  "dll",
  "so",
  "dylib",
  "bin",
  "wasm",
  "o",
  "a",
  "node",
  "class",
  "jar",
  "obj",
  "lib",
  "pdb",
  // design / docs
  "pdf",
  "psd",
  "ai",
  "sketch",
  "fig",
  "xcf",
  // data / db / packed
  "sqlite",
  "sqlite3",
  "db",
  "mdb",
  "dat",
  "pack",
  "idx",
  // disk / mobile artifacts
  "apk",
  "ipa",
  "dmg",
  "iso",
  "img",
  "aab",
])

const DEFAULT_MAX_FILE_SIZE = 2 * 1024 * 1024 // 2MB: skip anything bigger by default

export interface WorkspaceArchiveOptions {
  /** Include the full `.git` directory (history). Off by default — it's usually huge. */
  includeGit?: boolean
  /** Skip files larger than this many bytes (default 2MB). */
  maxFileSize?: number
}

export interface WorkspaceArchiveResult {
  path: string
  bytes: number
  fileCount: number
  skipped: number
  includedGit: boolean
  cleanup: () => Promise<void>
}

/**
 * Build a gzipped tarball of a session working directory to teleport to a remote
 * server. By design it ships only what's needed to keep coding: non-ignored
 * source/text files (tracked + untracked via `git ls-files`, so `node_modules`
 * and gitignored paths are never walked), skipping binary/media files and files
 * larger than `maxFileSize`. The heavy `.git` history is excluded unless
 * `includeGit` is set. For non-git dirs it walks the tree applying the same
 * binary/size filters.
 *
 * Returns the archive path, its size, and a `cleanup()`, or `null` if the
 * directory doesn't exist or no eligible files were found.
 */
export async function createWorkspaceArchive(
  directory: string,
  options: WorkspaceArchiveOptions = {},
): Promise<WorkspaceArchiveResult | null> {
  try {
    const { stat } = await import("fs/promises")
    if (!(await stat(directory)).isDirectory()) return null
  } catch {
    return null
  }

  const maxFileSize = options.maxFileSize ?? DEFAULT_MAX_FILE_SIZE
  const work = await mkdtemp(path.join(tmpdir(), "nikcli-teleport-"))
  const archivePath = path.join(work, "workspace.tar.gz")
  const cleanup = () => rm(work, { recursive: true, force: true }).catch(() => undefined)

  const root = (await gitTopLevel(directory)) ?? directory
  const isGit = root === directory && (await isGitRepo(directory))

  try {
    // Candidate files relative to root.
    let candidates: string[]
    if (isGit) {
      const listed = await runCaptureText(
        ["git", "-C", root, "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
        root,
      )
      candidates = listed.split("\0").filter(Boolean)
    } else {
      const found = await runCaptureText(
        ["find", ".", "-type", "f", "-not", "-path", "./node_modules/*", "-not", "-path", "./.git/*", "-print0"],
        root,
      )
      candidates = found
        .split("\0")
        .filter(Boolean)
        .map((p) => (p.startsWith("./") ? p.slice(2) : p))
    }

    // Filter out binaries and oversized files.
    const { stat } = await import("fs/promises")
    const included: string[] = []
    let skipped = 0
    await Promise.all(
      candidates.map(async (rel) => {
        const ext = path.extname(rel).slice(1).toLowerCase()
        if (BINARY_EXTENSIONS.has(ext)) {
          skipped++
          return
        }
        try {
          const s = await stat(path.join(root, rel))
          if (s.size > maxFileSize) {
            skipped++
            return
          }
        } catch {
          skipped++
          return
        }
        included.push(rel)
      }),
    )

    if (included.length === 0 && !options.includeGit) {
      await cleanup()
      return null
    }

    // Optionally prepend the full .git directory (history) when explicitly requested.
    const entries = options.includeGit && isGit ? [".git", ...included] : included
    const listFile = path.join(work, "files.txt")
    await Bun.write(listFile, entries.join("\0") + "\0")
    await runOk(["tar", "-czf", archivePath, "--null", "-C", root, "-T", listFile], root)

    const bytes = Bun.file(archivePath).size
    return {
      path: archivePath,
      bytes,
      fileCount: included.length,
      skipped,
      includedGit: Boolean(options.includeGit && isGit),
      cleanup,
    }
  } catch (error) {
    await cleanup()
    throw error
  }
}

/**
 * Stream a workspace tarball to a remote nikcli server in chunks, so a large
 * archive (working tree + .git) is never sent as one oversized request body.
 * Returns the server's `uploadID`, to be passed to `POST /mobile/teleport`.
 */
export async function uploadWorkspaceArchive(opts: {
  base: string
  token: string
  archivePath: string
  chunkSize?: number
  onProgress?: (sent: number, total: number) => void
}): Promise<string> {
  const auth = { authorization: `Bearer ${opts.token}` }
  const begin = await fetch(`${opts.base}/mobile/teleport/upload`, { method: "POST", headers: auth })
  if (!begin.ok) throw new Error(`upload init failed (${begin.status})`)
  const { uploadID } = (await begin.json()) as { uploadID: string }

  const file = Bun.file(opts.archivePath)
  const total = file.size
  const chunkSize = opts.chunkSize ?? 6 * 1024 * 1024
  let offset = 0
  while (offset < total) {
    const end = Math.min(offset + chunkSize, total)
    const body = await file.slice(offset, end).arrayBuffer()
    const res = await fetch(`${opts.base}/mobile/teleport/upload/${encodeURIComponent(uploadID)}`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/octet-stream" },
      body,
    })
    if (!res.ok) throw new Error(`chunk upload failed (${res.status})`)
    offset = end
    opts.onProgress?.(offset, total)
  }
  return uploadID
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
  const proc = Bun.spawn(cmd, { windowsHide: true, cwd, stdout: "pipe", stderr: "pipe" })
  const bytes = new Uint8Array(await new Response(proc.stdout).arrayBuffer())
  const code = await proc.exited
  if (code !== 0) throw new Error(`${cmd[0]} exited with code ${code}`)
  return bytes
}

async function runCaptureText(cmd: string[], cwd: string): Promise<string> {
  return new TextDecoder().decode(await runCapture(cmd, cwd))
}

async function runOk(cmd: string[], cwd: string): Promise<void> {
  const proc = Bun.spawn(cmd, { windowsHide: true, cwd, stdout: "ignore", stderr: "pipe" })
  const code = await proc.exited
  if (code !== 0) {
    const err = await new Response(proc.stderr).text().catch(() => "")
    throw new Error(`${cmd[0]} failed (${code})${err ? `: ${err.slice(0, 200)}` : ""}`)
  }
}
