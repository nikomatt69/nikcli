import { spawn } from "child_process"
import { Log } from "@/util/log"

const log = Log.create({ service: "git" })

const CONFIG = [
  "--no-optional-locks",
  "-c",
  "core.autocrlf=false",
  "-c",
  "core.fsmonitor=false",
  "-c",
  "core.longpaths=true",
  "-c",
  "core.symlinks=true",
  "-c",
  "core.quotepath=false",
] as const

export namespace Git {
  export type Kind = "added" | "deleted" | "modified"

  export type Base = {
    name: string
    ref: string
  }

  export type Item = {
    file: string
    code: string
    status: Kind
  }

  export type Stat = {
    file: string
    additions: number
    deletions: number
  }

  export type Patch = {
    text: string
    truncated: boolean
  }

  export type PatchOptions = {
    context?: number
  }

  export interface Result {
    exitCode: number
    text(): string
    stdout: Buffer
    stderr: Buffer
  }

  export interface Options {
    cwd: string
    env?: Record<string, string>
    stdin?: string | Uint8Array
  }

  function output(result: { text(): string }) {
    return result.text().trim()
  }

  function nuls(text: string) {
    return text.split("\0").filter(Boolean)
  }

  function failure(error: unknown): Result {
    const message = error instanceof Error ? error.message : String(error)
    return {
      exitCode: 1,
      text: () => "",
      stdout: Buffer.alloc(0),
      stderr: Buffer.from(message),
    }
  }

  function kind(code: string): Kind {
    if (code === "??") return "added"
    if (code.includes("U")) return "modified"
    if (code.includes("A") && !code.includes("D")) return "added"
    if (code.includes("D") && !code.includes("A")) return "deleted"
    return "modified"
  }

  export async function run(args: string[], opts: Options): Promise<Result> {
    try {
      const proc = spawn("git", [...CONFIG, ...args], {
        cwd: opts.cwd,
        env: {
          ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => !!entry[1])),
          ...opts.env,
        },
        stdio: [opts.stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      })

      if (opts.stdin !== undefined) {
        proc.stdin?.end(opts.stdin)
      }

      const stdoutChunks: Buffer[] = []
      const stderrChunks: Buffer[] = []
      proc.stdout?.on("data", (chunk) => stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
      proc.stderr?.on("data", (chunk) => stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))

      const exitCode = await new Promise<number>((resolve, reject) => {
        proc.once("error", reject)
        proc.once("close", (code) => resolve(code ?? 1))
      })

      const stdout = Buffer.concat(stdoutChunks)
      const stderr = Buffer.concat(stderrChunks)

      return {
        exitCode,
        text: () => stdout.toString("utf8"),
        stdout,
        stderr,
      }
    } catch (error) {
      log.warn("git command failed before spawn completed", { args, cwd: opts.cwd, error })
      return failure(error)
    }
  }

  async function lines(args: string[], opts: Options) {
    return output(await run(args, opts))
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean)
  }

  async function refs(cwd: string) {
    return lines(["for-each-ref", "--format=%(refname:short)", "refs/heads"], { cwd })
  }

  async function configuredDefaultBranch(cwd: string, list: string[]) {
    const result = await run(["config", "init.defaultBranch"], { cwd })
    const name = output(result)
    if (!name || !list.includes(name)) return undefined
    return { name, ref: name } satisfies Base
  }

  async function primaryRemote(cwd: string) {
    const remotes = await lines(["remote"], { cwd })
    if (remotes.includes("origin")) return "origin"
    if (remotes.length === 1) return remotes[0]
    if (remotes.includes("upstream")) return "upstream"
    return remotes[0]
  }

  export async function branch(cwd: string) {
    const result = await run(["symbolic-ref", "--quiet", "--short", "HEAD"], { cwd })
    if (result.exitCode !== 0) return undefined
    const text = output(result)
    return text || undefined
  }

  export async function prefix(cwd: string) {
    const result = await run(["rev-parse", "--show-prefix"], { cwd })
    if (result.exitCode !== 0) return ""
    return output(result)
  }

  export async function defaultBranch(cwd: string): Promise<Base | undefined> {
    const remote = await primaryRemote(cwd)
    if (remote) {
      const head = await run(["symbolic-ref", `refs/remotes/${remote}/HEAD`], { cwd })
      if (head.exitCode === 0) {
        const ref = output(head).replace(/^refs\/remotes\//, "")
        const name = ref.startsWith(`${remote}/`) ? ref.slice(`${remote}/`.length) : ""
        if (name) return { name, ref }
      }
    }

    const list = await refs(cwd)
    const configured = await configuredDefaultBranch(cwd, list)
    if (configured) return configured
    if (list.includes("main")) return { name: "main", ref: "main" }
    if (list.includes("master")) return { name: "master", ref: "master" }
    return undefined
  }

  export async function hasHead(cwd: string) {
    const result = await run(["rev-parse", "--verify", "HEAD"], { cwd })
    return result.exitCode === 0
  }

  export async function mergeBase(cwd: string, base: string, head = "HEAD") {
    const result = await run(["merge-base", base, head], { cwd })
    if (result.exitCode !== 0) return undefined
    const text = output(result)
    return text || undefined
  }

  export async function show(cwd: string, ref: string, file: string, prefix = "") {
    const target = prefix ? `${prefix}${file}` : file
    const result = await run(["show", `${ref}:${target}`], { cwd })
    if (result.exitCode !== 0 || result.stdout.includes(0)) return ""
    return result.text()
  }

  export async function status(cwd: string): Promise<Item[]> {
    return nuls(
      output(
        await run(["status", "--porcelain=v1", "--untracked-files=all", "--no-renames", "-z", "--", "."], { cwd }),
      ),
    ).flatMap((item) => {
      const file = item.slice(3)
      if (!file) return []
      const code = item.slice(0, 2)
      return [{ file, code, status: kind(code) } satisfies Item]
    })
  }

  export async function diff(cwd: string, ref: string): Promise<Item[]> {
    const list = nuls(
      output(await run(["diff", "--no-ext-diff", "--no-renames", "--name-status", "-z", ref, "--", "."], { cwd })),
    )
    return list.flatMap((code, index) => {
      if (index % 2 !== 0) return []
      const file = list[index + 1]
      if (!code || !file) return []
      return [{ file, code, status: kind(code) } satisfies Item]
    })
  }

  export async function stats(cwd: string, ref: string): Promise<Stat[]> {
    return nuls(
      output(await run(["diff", "--no-ext-diff", "--no-renames", "--numstat", "-z", ref, "--", "."], { cwd })),
    ).flatMap((item) => {
      const firstTab = item.indexOf("\t")
      const secondTab = item.indexOf("\t", firstTab + 1)
      if (firstTab === -1 || secondTab === -1) return []
      const file = item.slice(secondTab + 1)
      if (!file) return []

      const additionsRaw = item.slice(0, firstTab)
      const deletionsRaw = item.slice(firstTab + 1, secondTab)
      const additions = additionsRaw === "-" ? 0 : Number.parseInt(additionsRaw || "0", 10)
      const deletions = deletionsRaw === "-" ? 0 : Number.parseInt(deletionsRaw || "0", 10)

      return [
        {
          file,
          additions: Number.isFinite(additions) ? additions : 0,
          deletions: Number.isFinite(deletions) ? deletions : 0,
        } satisfies Stat,
      ]
    })
  }

  export async function patchAll(cwd: string, ref: string, options?: PatchOptions): Promise<Patch> {
    const result = await run(
      ["diff", "--patch", "--no-ext-diff", "--no-renames", `--unified=${options?.context ?? 3}`, ref, "--", "."],
      { cwd },
    )
    return { text: result.text(), truncated: false }
  }

  export async function patchUntracked(cwd: string, file: string, options?: PatchOptions): Promise<Patch> {
    const result = await run(
      [
        "diff",
        "--no-index",
        "--patch",
        "--no-ext-diff",
        "--no-renames",
        `--unified=${options?.context ?? 3}`,
        "--",
        "/dev/null",
        file,
      ],
      { cwd },
    )
    return { text: result.text(), truncated: false }
  }

  export async function statUntracked(cwd: string, file: string): Promise<Stat | undefined> {
    const result = await run(["diff", "--no-index", "--numstat", "--", "/dev/null", file], { cwd })
    const parts = result.text().split("\t")
    if (parts.length < 2) return undefined

    const additionsRaw = parts[0]
    const deletionsRaw = parts[1]
    const additions = additionsRaw === "-" ? 0 : Number.parseInt(additionsRaw || "0", 10)
    const deletions = deletionsRaw === "-" ? 0 : Number.parseInt(deletionsRaw || "0", 10)

    return {
      file,
      additions: Number.isFinite(additions) ? additions : 0,
      deletions: Number.isFinite(deletions) ? deletions : 0,
    }
  }

  export async function applyPatch(cwd: string, patch: string): Promise<Result> {
    return run(["apply", "--whitespace=nowarn", "-"], { cwd, stdin: patch })
  }
}
