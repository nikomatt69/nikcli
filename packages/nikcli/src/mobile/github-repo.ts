import fs from "fs/promises"
import path from "path"
import z from "zod"
import { Global } from "@/global"
import { Project } from "@/project/project"
import { Log } from "@/util/log"

const log = Log.create({ service: "mobile-github-repo" })

export namespace MobileGithubRepo {
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
      owner: z.string().min(1),
      repo: z.string().min(1),
      cloneUrl: z.url(),
      defaultBranch: z.string().min(1),
      private: z.boolean().default(false),
    })
    .meta({ ref: "MobileGithubImportRequest" })

  export type ImportRequest = z.infer<typeof ImportRequest>

  const ROOT = path.join(Global.Path.data, "mobile-repos")
  const FILE = path.join(Global.Path.data, "mobile-github-imports.json")

  function target(owner: string, repo: string) {
    return path.join(ROOT, owner.toLowerCase(), repo.toLowerCase())
  }

  async function write(imports: Import[]) {
    await fs.mkdir(ROOT, { recursive: true })
    await Bun.write(Bun.file(FILE), JSON.stringify(imports, null, 2))
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

  function gitEnv(token?: string) {
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

  export async function runGit(args: string[], options: { cwd?: string; token?: string }) {
    const proc = Bun.spawn(["git", ...args], {
      cwd: options.cwd,
      env: Object.fromEntries(
        Object.entries(gitEnv(options.token)).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      ),
      stdout: "pipe",
      stderr: "pipe",
    })

    const [exitCode, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ])

    if (exitCode !== 0) {
      throw new Error(stderr.trim() || stdout.trim() || `git ${args.join(" ")} failed`)
    }

    return (stdout.trim() ?? "").replace(/\0+$/, "")
  }

  export async function prepareManagedClone(input: ImportRequest, token: string) {
    const directory = target(input.owner, input.repo)
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
          [
            "clone",
            "--filter=blob:none",
            "--branch",
            input.defaultBranch,
            "--single-branch",
            input.cloneUrl,
            directory,
          ],
          { token },
        )
      } catch (error) {
        if (input.private) throw error
        await fs.rm(directory, { recursive: true, force: true }).catch(() => undefined)
        await runGit(
          [
            "clone",
            "--filter=blob:none",
            "--branch",
            input.defaultBranch,
            "--single-branch",
            input.cloneUrl,
            directory,
          ],
          {},
        )
      }
      return directory
    }

    try {
      await runGit(["fetch", "origin", input.defaultBranch, "--prune"], { cwd: directory, token })
      await runGit(["checkout", "-B", input.defaultBranch, `origin/${input.defaultBranch}`], { cwd: directory, token })
    } catch (error) {
      if (input.private) throw error
      await runGit(["fetch", "origin", input.defaultBranch, "--prune"], { cwd: directory })
      await runGit(["checkout", "-B", input.defaultBranch, `origin/${input.defaultBranch}`], { cwd: directory })
    }
    return directory
  }

  export async function importRepo(input: ImportRequest, token: string) {
    const directory = await prepareManagedClone(input, token)
    const { project } = await Project.fromDirectory(directory)
    const now = Date.now()
    const existing = (await list()).find((item) => item.fullName === `${input.owner}/${input.repo}`)
    const entry = await save({
      owner: input.owner,
      repo: input.repo,
      fullName: `${input.owner}/${input.repo}`,
      directory,
      cloneUrl: input.cloneUrl,
      defaultBranch: input.defaultBranch,
      private: input.private,
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
