import fs from "fs/promises"
import path from "path"
import z from "zod"
import { Global } from "@/global"
import { Project } from "@/project/project"
import { Log } from "@/util/log"
import { Effect } from "effect"
import { runPromiseWithLayer } from "@/effect"

const log = Log.create({ service: "mobile-github-repo" })

function runProject<A, E>(effect: Effect.Effect<A, E, Project.Service>) {
  return runPromiseWithLayer(Project.defaultLayer, effect)
}

export namespace MobileGithubRepo {
  export const Owner = z
    .string()
    .trim()
    .min(1)
    .regex(/^[A-Za-z0-9_.-]+$/, "GitHub owner contains unsupported characters")
    .refine((value) => value !== "." && value !== "..", "GitHub owner is invalid")

  export const Repository = z
    .string()
    .trim()
    .min(1)
    .regex(/^[A-Za-z0-9_.-]+$/, "GitHub repository contains unsupported characters")
    .refine((value) => value !== "." && value !== "..", "GitHub repository is invalid")

  export const Import = z
    .object({
      owner: z.string(),
      repo: z.string(),
      fullName: z.string(),
      directory: z.string(),
      cloneUrl: z.string(),
      defaultBranch: z.string(),
      private: z.boolean(),
      importedAt: z.number(),
      updatedAt: z.number(),
      projectID: z.string().optional(),
    })
    .meta({ ref: "MobileGithubImport" })

  export type Import = z.infer<typeof Import>

  export const ImportRequest = z
    .object({
      owner: Owner,
      repo: Repository,
      cloneUrl: z.url(),
      defaultBranch: z.string().min(1),
      private: z.boolean().default(false),
    })
    .superRefine((input, ctx) => {
      if (!isSafeCloneUrl(input)) {
        ctx.addIssue({
          code: "custom",
          path: ["cloneUrl"],
          message: "cloneUrl must be an HTTPS github.com URL matching owner/repo",
        })
      }
    })
    .meta({ ref: "MobileGithubImportRequest" })

  export type ImportRequest = z.infer<typeof ImportRequest>

  const ROOT = path.join(Global.Path.data, "mobile-repos")
  const FILE = path.join(Global.Path.data, "mobile-github-imports.json")

  function target(owner: string, repo: string) {
    const root = path.resolve(ROOT)
    const directory = path.resolve(root, owner.toLowerCase(), repo.toLowerCase())
    const relative = path.relative(root, directory)
    if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error("Invalid GitHub repository path")
    }
    return directory
  }

  export function canonicalCloneUrl(input: { owner: string; repo: string }) {
    return `https://github.com/${encodeURIComponent(input.owner.trim())}/${encodeURIComponent(input.repo.trim())}.git`
  }

  export function isSafeCloneUrl(input: { owner: string; repo: string; cloneUrl: string }) {
    try {
      const url = new URL(input.cloneUrl)
      if (url.protocol !== "https:") return false
      if (url.hostname.toLowerCase() !== "github.com") return false
      if (url.username || url.password || url.port || url.search || url.hash) return false

      const parts = url.pathname.split("/").filter(Boolean)
      if (parts.length !== 2) return false

      const [owner, rawRepo] = parts.map((part) => decodeURIComponent(part).toLowerCase())
      const repo = rawRepo.endsWith(".git") ? rawRepo.slice(0, -4) : rawRepo
      return owner === input.owner.trim().toLowerCase() && repo === input.repo.trim().toLowerCase()
    } catch {
      return false
    }
  }

  async function write(imports: Import[]) {
    await fs.mkdir(ROOT, { recursive: true })
    await Bun.write(FILE, JSON.stringify(imports, null, 2))
  }

  export async function list(): Promise<Import[]> {
    const data = await Bun.file(FILE)
      .json()
      .catch(() => [])
    const parsed = z.array(Import).safeParse(data)
    if (!parsed.success) return []
    return parsed.data
  }

  async function save(entry: Import) {
    const imports = await list()
    const next = imports.filter((item) => item.fullName !== entry.fullName)
    next.push(entry)
    next.sort((a, b) => b.updatedAt - a.updatedAt)
    await write(next)
    return entry
  }

  const GIT_AUTHOR_NAME = "nikcli[bot]"
  const GIT_AUTHOR_EMAIL = "nikcli[bot]@users.noreply.github.com"
  const GIT_IDENTITY_ARGS = ["-c", `user.name=${GIT_AUTHOR_NAME}`, "-c", `user.email=${GIT_AUTHOR_EMAIL}`] as const

  function gitEnv(token?: string | null) {
    if (!token) return process.env

    const auth = Buffer.from(`x-access-token:${token}`).toString("base64")
    return {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "http.extraHeader",
      GIT_CONFIG_VALUE_0: `Authorization: Basic ${auth}`,
    }
  }

  export async function runGit(args: string[], options: { cwd?: string; token?: string | null }) {
    const entries = Object.entries(gitEnv(options.token)).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    )
    const proc = Bun.spawn(["git", ...GIT_IDENTITY_ARGS, ...args], {
      windowsHide: true,
      cwd: options.cwd,
      env: Object.fromEntries(entries),
      stdout: "pipe",
      stderr: "pipe",
    })

    const [exitCode, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text().then((s): string => s ?? ""),
      new Response(proc.stderr).text().then((s): string => s ?? ""),
    ])

    if (exitCode !== 0) {
      throw new Error(stderr.trim() || stdout.trim() || `git ${args.join(" ")} failed`)
    }

    return String(stdout.trim() || "").replace(/\0+$/, "")
  }

  export async function prepareManagedClone(input: ImportRequest, token: string) {
    const request = ImportRequest.parse(input)
    const directory = target(request.owner, request.repo)
    const cloneUrl = canonicalCloneUrl(request)
    await fs.mkdir(path.dirname(directory), { recursive: true })
    const gitDir = path.join(directory, ".git")
    const exists = await fs
      .stat(gitDir)
      .then((stat) => stat.isDirectory())
      .catch(() => false)

    if (!exists) {
      await fs.rm(directory, { recursive: true, force: true }).catch(() => undefined)
      try {
        await runGit(
          ["clone", "--filter=blob:none", "--branch", request.defaultBranch, "--single-branch", cloneUrl, directory],
          { token },
        )
      } catch (error) {
        if (request.private) throw error
        await fs.rm(directory, { recursive: true, force: true }).catch(() => undefined)
        await runGit(
          ["clone", "--filter=blob:none", "--branch", request.defaultBranch, "--single-branch", cloneUrl, directory],
          {},
        )
      }
      return directory
    }

    try {
      await runGit(["fetch", "origin", request.defaultBranch, "--prune"], { cwd: directory, token })
      await runGit(["checkout", "-B", request.defaultBranch, `origin/${request.defaultBranch}`], {
        cwd: directory,
        token,
      })
    } catch (error) {
      if (request.private) throw error
      await runGit(["fetch", "origin", request.defaultBranch, "--prune"], { cwd: directory })
      await runGit(["checkout", "-B", request.defaultBranch, `origin/${request.defaultBranch}`], { cwd: directory })
    }
    return directory
  }

  export async function importRepo(input: ImportRequest, token: string) {
    const request = ImportRequest.parse(input)
    const directory = await prepareManagedClone(request, token)
    const { project } = await runProject(
      Effect.gen(function* () {
        const project = yield* Project.Service
        return yield* project.fromDirectory(directory)
      }),
    )
    const now = Date.now()
    const existing = (await list()).find((item) => item.fullName === `${request.owner}/${request.repo}`)
    const entry = await save({
      owner: request.owner,
      repo: request.repo,
      fullName: `${request.owner}/${request.repo}`,
      directory,
      cloneUrl: canonicalCloneUrl(request),
      defaultBranch: request.defaultBranch,
      private: request.private,
      importedAt: existing?.importedAt ?? now,
      updatedAt: now,
      projectID: project.id,
    })
    log.info("imported github repo for mobile", { fullName: entry.fullName, directory: entry.directory })
    return {
      import: entry,
      project,
    }
  }
}
