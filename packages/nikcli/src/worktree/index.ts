import { $ } from "bun"
import fs from "fs/promises"
import path from "path"
import z from "zod"
import { Global } from "../global"
import { Git } from "@/git"
import { Log } from "@/util/log"
import { Lock } from "@/util/lock"
import { InstanceState, type InstanceContext } from "@/effect"
import { zodObject } from "@/util/effect-zod"
import { Context, Effect, Layer, Schema } from "effect"
export * from "./managed"

export namespace Worktree {
  const InfoSchema = Schema.Struct({
    name: Schema.String,
    branch: Schema.String,
    directory: Schema.String,
  }).annotate({ identifier: "Worktree" })
  export const Info = zodObject(InfoSchema)
  export type Info = Schema.Schema.Type<typeof InfoSchema>

  const CreateInputSchema = Schema.Struct({
    name: Schema.optional(Schema.String),
    branch: Schema.optional(Schema.String),
    branchPrefix: Schema.optional(Schema.String),
    baseBranch: Schema.optional(Schema.String),
    remote: Schema.optional(Schema.String),
    startCommand: Schema.optional(Schema.String),
  }).annotate({ identifier: "WorktreeCreateInput" })
  export const CreateInput = zodObject(CreateInputSchema)
  export type CreateInput = Schema.Schema.Type<typeof CreateInputSchema>

  const RemoveInputSchema = Schema.Struct({
    directory: Schema.String,
  }).annotate({ identifier: "WorktreeRemoveInput" })
  export const RemoveInput = zodObject(RemoveInputSchema)
  export type RemoveInput = Schema.Schema.Type<typeof RemoveInputSchema>

  const ResetInputSchema = Schema.Struct({
    directory: Schema.String,
  }).annotate({ identifier: "WorktreeResetInput" })
  export const ResetInput = zodObject(ResetInputSchema)
  export type ResetInput = Schema.Schema.Type<typeof ResetInputSchema>

  export class NotGitError extends Schema.TaggedErrorClass<NotGitError>()("WorktreeNotGitError", {
    message: Schema.String,
  }) {}

  export class NameGenerationFailedError extends Schema.TaggedErrorClass<NameGenerationFailedError>()(
    "WorktreeNameGenerationFailedError",
    {
      message: Schema.String,
    },
  ) {}

  export class CreateFailedError extends Schema.TaggedErrorClass<CreateFailedError>()("WorktreeCreateFailedError", {
    message: Schema.String,
  }) {}

  export class StartCommandFailedError extends Schema.TaggedErrorClass<StartCommandFailedError>()(
    "WorktreeStartCommandFailedError",
    {
      message: Schema.String,
    },
  ) {}

  export class RemoveFailedError extends Schema.TaggedErrorClass<RemoveFailedError>()("WorktreeRemoveFailedError", {
    message: Schema.String,
  }) {}

  export class ResetFailedError extends Schema.TaggedErrorClass<ResetFailedError>()("WorktreeResetFailedError", {
    message: Schema.String,
  }) {}

  /**
   * Union of all errors that any `Worktree.Service` method can fail with. Use
   * this in the Effect error channel of downstream consumers so they can
   * `Effect.catchTag` against the specific error class.
   */
  export type Error =
    | NotGitError
    | NameGenerationFailedError
    | CreateFailedError
    | StartCommandFailedError
    | RemoveFailedError
    | ResetFailedError

  const ADJECTIVES = [
    "brave",
    "calm",
    "clever",
    "cosmic",
    "crisp",
    "curious",
    "eager",
    "gentle",
    "glowing",
    "happy",
    "hidden",
    "jolly",
    "kind",
    "lucky",
    "mighty",
    "misty",
    "neon",
    "nimble",
    "playful",
    "proud",
    "quick",
    "quiet",
    "shiny",
    "silent",
    "stellar",
    "sunny",
    "swift",
    "tidy",
    "witty",
  ] as const

  const NOUNS = [
    "cabin",
    "cactus",
    "canyon",
    "circuit",
    "comet",
    "eagle",
    "engine",
    "falcon",
    "forest",
    "garden",
    "harbor",
    "island",
    "knight",
    "lagoon",
    "meadow",
    "moon",
    "mountain",
    "nebula",
    "orchid",
    "otter",
    "panda",
    "pixel",
    "planet",
    "river",
    "rocket",
    "sailor",
    "squid",
    "star",
    "tiger",
    "wizard",
    "wolf",
  ] as const

  function pick<const T extends readonly string[]>(list: T) {
    return list[Math.floor(Math.random() * list.length)]
  }

  function slug(input: string) {
    return input
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+/, "")
      .replace(/-+$/, "")
  }

  function randomName() {
    return `${pick(ADJECTIVES)}-${pick(NOUNS)}`
  }

  function branchName(input: string) {
    return input
      .split("/")
      .map((part) => slug(part))
      .filter(Boolean)
      .join("/")
  }

  async function exists(target: string) {
    return fs
      .stat(target)
      .then(() => true)
      .catch(() => false)
  }

  async function canonicalPath(target: string) {
    return fs.realpath(target).catch(() => path.resolve(target))
  }

  function outputText(input: Uint8Array | undefined) {
    if (!input?.length) return ""
    return new TextDecoder().decode(input).trim()
  }

  function errorText(result: { stdout?: Uint8Array; stderr?: Uint8Array }) {
    return [outputText(result.stderr), outputText(result.stdout)].filter(Boolean).join("\n")
  }

  const log = Log.create({ service: "worktree" })

  export type WorktreeEntry = { path?: string; branch?: string }
  type RegistryRecord = Info & { createdAt: number; updatedAt: number }

  export class Service extends Context.Service<
    Service,
    {
      create(input?: CreateInput): Effect.Effect<Info, Error>
      remove(input: RemoveInput): Effect.Effect<boolean, Error>
      reset(input: ResetInput): Effect.Effect<boolean, Error>
      list(): Effect.Effect<Info[], Error>
    }
  >()("Worktree.Service") {}

  /**
   * Preserve the typed worktree error thrown by an impl. Falls back to
   * `CreateFailedError` for unexpected non-`Worktree.Error` rejections so the
   * service's Effect error channel stays typed at the `Worktree.Error` union.
   */
  function asWorktreeError(e: unknown): Error {
    if (e instanceof NotGitError) return e
    if (e instanceof NameGenerationFailedError) return e
    if (e instanceof CreateFailedError) return e
    if (e instanceof StartCommandFailedError) return e
    if (e instanceof RemoveFailedError) return e
    if (e instanceof ResetFailedError) return e
    if (e instanceof Error) return new CreateFailedError({ message: e.message })
    return new CreateFailedError({ message: String(e) })
  }

  export const layer = Layer.succeed(
    Service,
    Service.of({
      create(input) {
        return Effect.gen(function* () {
          const ctx = yield* InstanceState.context
          return yield* Effect.tryPromise({
            try: () => createImpl(ctx, CreateInput.optional().parse(input)),
            catch: asWorktreeError,
          })
        })
      },
      remove(input) {
        return Effect.gen(function* () {
          const ctx = yield* InstanceState.context
          return yield* Effect.tryPromise({
            try: () => removeImpl(ctx, RemoveInput.parse(input)),
            catch: asWorktreeError,
          })
        })
      },
      reset(input) {
        return Effect.gen(function* () {
          const ctx = yield* InstanceState.context
          return yield* Effect.tryPromise({
            try: () => resetImpl(ctx, ResetInput.parse(input)),
            catch: asWorktreeError,
          })
        })
      },
      list() {
        return Effect.gen(function* () {
          const ctx = yield* InstanceState.context
          return yield* Effect.tryPromise({
            try: () => listImpl(ctx),
            catch: asWorktreeError,
          })
        })
      },
    }),
  )

  export const defaultLayer = layer

  function rootDirectory(ctx: InstanceContext) {
    return path.join(Global.Path.data, "worktree", ctx.project.id)
  }

  function registryFile(root: string) {
    return path.join(root, "registry.json")
  }

  export function isManagedDirectory(directory: string, root: string) {
    const relative = path.relative(path.resolve(root), path.resolve(directory))
    return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
  }

  async function readRegistry(root: string): Promise<RegistryRecord[]> {
    const file = registryFile(root)
    if (!(await Bun.file(file).exists())) return []
    return z.array(Info.extend({ createdAt: z.number(), updatedAt: z.number() })).parse(await Bun.file(file).json())
  }

  async function writeRegistry(records: RegistryRecord[], root: string) {
    await fs.mkdir(root, { recursive: true })
    await Bun.write(registryFile(root), JSON.stringify(records, null, 2))
  }

  async function remember(info: Info, root: string) {
    using _ = await Lock.write(`worktree-registry:${root}`)
    const now = Date.now()
    const directory = await canonicalPath(info.directory)
    const records = []
    for (const item of await readRegistry(root)) {
      if ((await canonicalPath(item.directory)) !== directory) records.push(item)
    }
    records.push({ ...info, directory, createdAt: now, updatedAt: now })
    await writeRegistry(records, root)
  }

  async function forget(directory: string, root: string) {
    using _ = await Lock.write(`worktree-registry:${root}`)
    const resolved = await canonicalPath(directory)
    const records = []
    for (const item of await readRegistry(root)) {
      if ((await canonicalPath(item.directory)) !== resolved) records.push(item)
    }
    await writeRegistry(records, root)
  }

  async function assertManagedMutation(
    ctx: InstanceContext,
    directory: string,
    error: typeof RemoveFailedError | typeof ResetFailedError,
  ) {
    if ((await canonicalPath(directory)) === (await canonicalPath(ctx.worktree))) {
      throw new error({ message: "Cannot mutate the primary workspace" })
    }
    const root = rootDirectory(ctx)
    if (isManagedDirectory(directory, root)) return
    const records = await readRegistry(root)
    const resolved = await canonicalPath(directory)
    for (const item of records) {
      if ((await canonicalPath(item.directory)) === resolved) return
    }
    throw new error({ message: "Refusing to mutate a worktree outside nikcli's managed worktree directory" })
  }

  async function listWorktrees(ctx: InstanceContext, cwd?: string): Promise<WorktreeEntry[]> {
    const worktreeCwd = cwd ?? ctx.worktree
    const list = await Git.run(["worktree", "list", "--porcelain"], { cwd: worktreeCwd })
    if (list.exitCode !== 0) {
      throw new RemoveFailedError({ message: list.text().trim() || "Failed to read git worktrees" })
    }

    const lines = list
      .text()
      .split("\n")
      .map((line) => line.trim())
    return lines.reduce<WorktreeEntry[]>((acc, line) => {
      if (!line) return acc
      if (line.startsWith("worktree ")) {
        acc.push({ path: line.slice("worktree ".length).trim() })
        return acc
      }
      const current = acc[acc.length - 1]
      if (!current) return acc
      if (line.startsWith("branch ")) {
        current.branch = line.slice("branch ".length).trim()
      }
      return acc
    }, [])
  }

  /**
   * Parse git worktree list --porcelain output into Worktree.Info objects.
   * Used internally by the Effect service list method.
   */
  async function parseWorktrees(ctx: InstanceContext, cwd?: string): Promise<Info[]> {
    const entries = await listWorktrees(ctx, cwd)
    const primary = await canonicalPath(ctx.worktree)
    const primaryName = path.basename(primary).toLowerCase()
    const result: Info[] = []
    for (const entry of entries) {
      if (!entry.path) continue
      const base = path.basename(entry.path)
      // When a worktree's folder name collides with the primary worktree's name,
      // disambiguate by using its parent folder name instead.
      const isPrimary = (await canonicalPath(entry.path)) === primary
      const name = !isPrimary && base.toLowerCase() === primaryName ? path.basename(path.dirname(entry.path)) : base
      const branch = entry.branch?.replace(/^refs\/heads\//, "") ?? ""
      result.push(Info.parse({ name, branch, directory: entry.path }))
    }
    return result
  }

  async function findWorktreeEntry(
    ctx: InstanceContext,
    directory: string,
    cwd?: string,
  ): Promise<WorktreeEntry | undefined> {
    const entries = await listWorktrees(ctx, cwd)
    const resolved = await canonicalPath(directory)
    for (const item of entries) {
      if (item.path && (await canonicalPath(item.path)) === resolved) return item
    }
    return undefined
  }

  async function remotes(ctx: InstanceContext) {
    const remoteList = await Git.run(["remote"], { cwd: ctx.worktree })
    if (remoteList.exitCode !== 0) return [] as string[]
    return remoteList
      .text()
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
  }

  async function detectRemote(ctx: InstanceContext, preferred?: string) {
    const values = await remotes(ctx)
    if (preferred && values.includes(preferred)) return preferred
    if (values.includes("origin")) return "origin"
    if (values.length === 1) return values[0]
    if (values.includes("upstream")) return "upstream"
    return ""
  }

  async function candidate(
    ctx: InstanceContext,
    root: string,
    input?: { name?: string; branch?: string; branchPrefix?: string },
  ) {
    for (const attempt of Array.from({ length: 26 }, (_, i) => i)) {
      const base = input?.name
      const name = base ? (attempt === 0 ? base : `${base}-${randomName()}`) : randomName()
      const branch = input?.branch
        ? attempt === 0
          ? input.branch
          : `${input.branch}-${attempt}`
        : `${input?.branchPrefix || "nikcli"}/${name}`
      const directory = path.join(root, name)

      if (await exists(directory)) continue

      const ref = `refs/heads/${branch}`
      const branchCheck = await Git.run(["show-ref", "--verify", "--quiet", ref], { cwd: ctx.worktree })
      if (branchCheck.exitCode === 0) continue

      return Info.parse({ name, branch, directory })
    }

    throw new NameGenerationFailedError({ message: "Failed to generate a unique worktree name" })
  }

  async function runStartCommand(directory: string, cmd: string) {
    if (process.platform === "win32") {
      return $`cmd /c ${cmd}`.nothrow().cwd(directory)
    }
    return $`bash -lc ${cmd}`.nothrow().cwd(directory)
  }

  async function createImpl(ctx: InstanceContext, input?: CreateInput) {
    if (ctx.project.vcs !== "git") {
      throw new NotGitError({ message: "Worktrees are only supported for git projects" })
    }

    const root = rootDirectory(ctx)
    await fs.mkdir(root, { recursive: true })

    const base = input?.name ? slug(input.name) : ""
    const explicitBranch = input?.branch ? branchName(input.branch) : ""
    const branchPrefix = input?.branchPrefix
      ?.split("/")
      .map((part) => slug(part))
      .filter(Boolean)
      .join("/")
    const info = await candidate(ctx, root, {
      name: base || undefined,
      branch: explicitBranch || undefined,
      branchPrefix: branchPrefix || undefined,
    })

    const remote = await detectRemote(ctx, input?.remote)
    const baseBranch = input?.baseBranch?.trim()
    const target = baseBranch ? (remote ? `${remote}/${baseBranch}` : baseBranch) : undefined

    if (baseBranch && remote) {
      const remoteHead = `refs/heads/${baseBranch}`
      const remoteTracking = `refs/remotes/${remote}/${baseBranch}`
      const fetchRefspec = `+${remoteHead}:${remoteTracking}`
      const fetch = await Git.run(["fetch", remote, fetchRefspec], { cwd: ctx.worktree })
      if (fetch.exitCode !== 0) {
        throw new CreateFailedError({ message: fetch.text().trim() || `Failed to fetch ${target}` })
      }
    }

    const created = target
      ? await Git.run(["worktree", "add", "-b", info.branch, info.directory, target], { cwd: ctx.worktree })
      : await Git.run(["worktree", "add", "-b", info.branch, info.directory], { cwd: ctx.worktree })
    if (created.exitCode !== 0) {
      throw new CreateFailedError({ message: created.text().trim() || "Failed to create git worktree" })
    }

    // Symlink node_modules from the main worktree so workspace packages (e.g. @nikcli-ai/plugin) resolve correctly
    const mainNodeModules = path.join(ctx.worktree, "node_modules")
    const worktreeNodeModules = path.join(info.directory, "node_modules")
    if ((await exists(mainNodeModules)) && !(await exists(worktreeNodeModules))) {
      const symlinkResult = await fs.symlink(mainNodeModules, worktreeNodeModules).catch((err) => {
        log.warn("symlink node_modules failed", { directory: info.directory, error: err?.message })
        return undefined
      })
      if (symlinkResult === undefined) {
        log.warn("node_modules symlink skipped, worktree may need manual setup", { directory: info.directory })
      }
    }

    try {
      await remember(info, root)
      const cmd = input?.startCommand?.trim()
      if (cmd) {
        const ran = await runStartCommand(info.directory, cmd)
        if (ran.exitCode !== 0) {
          throw new StartCommandFailedError({ message: errorText(ran) || "Worktree start command failed" })
        }
      }
    } catch (err) {
      // Cleanup worktree on post-creation failure
      log.warn("post-creation failed, cleaning up worktree", { directory: info.directory, error: String(err) })
      try {
        const removed = await Git.run(["worktree", "remove", "--force", info.directory], { cwd: ctx.worktree })
        if (removed.exitCode === 0) {
          await forget(info.directory, root)
        } else {
          log.error("worktree cleanup failed", { directory: info.directory, error: removed.text().trim() })
        }
      } catch (cleanupErr) {
        log.error("worktree cleanup failed", { directory: info.directory, error: String(cleanupErr) })
      }
      throw err
    }

    return info
  }

  async function removeImpl(ctx: InstanceContext, input: RemoveInput) {
    if (ctx.project.vcs !== "git") {
      throw new NotGitError({ message: "Worktrees are only supported for git projects" })
    }

    const directory = path.resolve(input.directory)
    await assertManagedMutation(ctx, directory, RemoveFailedError)
    const entry = await findWorktreeEntry(ctx, directory)
    if (!entry?.path) {
      throw new RemoveFailedError({ message: "Worktree not found" })
    }

    const removed = await Git.run(["worktree", "remove", "--force", entry.path], { cwd: ctx.worktree })
    if (removed.exitCode !== 0) {
      throw new RemoveFailedError({ message: removed.text().trim() || "Failed to remove git worktree" })
    }

    await forget(entry.path, rootDirectory(ctx))

    const branch = entry.branch?.replace(/^refs\/heads\//, "")
    if (branch) {
      const deleted = await Git.run(["branch", "-D", branch], { cwd: ctx.worktree })
      if (deleted.exitCode !== 0) {
        throw new RemoveFailedError({ message: deleted.text().trim() || "Failed to delete worktree branch" })
      }
    }

    return true
  }

  async function resetImpl(ctx: InstanceContext, input: ResetInput) {
    if (ctx.project.vcs !== "git") {
      throw new NotGitError({ message: "Worktrees are only supported for git projects" })
    }

    const directory = path.resolve(input.directory)
    await assertManagedMutation(ctx, directory, ResetFailedError)

    const entry = await findWorktreeEntry(ctx, directory)
    if (!entry?.path) {
      throw new ResetFailedError({ message: "Worktree not found" })
    }

    const worktreePath = entry.path

    const base = await Git.defaultBranch(ctx.worktree)
    if (!base) {
      throw new ResetFailedError({ message: "Default branch not found" })
    }

    const target = base.ref
    const remote = target.includes("/") ? target.split("/", 1)[0] : ""
    const remoteBranch = remote && target.startsWith(`${remote}/`) ? base.name : ""

    if (remote && remoteBranch) {
      const fetch = await Git.run(["fetch", remote, remoteBranch], { cwd: ctx.worktree })
      if (fetch.exitCode !== 0) {
        throw new ResetFailedError({ message: fetch.text().trim() || `Failed to fetch ${target}` })
      }
    }

    const resetToTarget = await Git.run(["reset", "--hard", target], { cwd: worktreePath })
    if (resetToTarget.exitCode !== 0) {
      throw new ResetFailedError({ message: resetToTarget.text().trim() || "Failed to reset worktree to target" })
    }

    const clean = await Git.run(["clean", "-fdx"], { cwd: worktreePath })
    if (clean.exitCode !== 0) {
      throw new ResetFailedError({ message: clean.text().trim() || "Failed to clean worktree" })
    }

    // Parallel submodule operations using Promise.allSettled
    const submoduleOps = await Promise.allSettled([
      Git.run(["submodule", "update", "--init", "--recursive", "--force"], { cwd: worktreePath }),
      Git.run(["submodule", "foreach", "--recursive", "git", "reset", "--hard"], { cwd: worktreePath }),
      Git.run(["submodule", "foreach", "--recursive", "git", "clean", "-fdx"], { cwd: worktreePath }),
    ])

    const failures = submoduleOps
      .map((result, index) => {
        if (result.status === "rejected") return { index, error: result.reason }
        if (result.status === "fulfilled" && result.value.exitCode !== 0) {
          return { index, error: result.value.text().trim() }
        }
        return null
      })
      .filter(Boolean)

    if (failures.length > 0) {
      const messages = failures.map((f) => {
        const names = ["submodule update", "submodule reset", "submodule clean"]
        return `${names[f!.index]}: ${f!.error}`
      })
      throw new ResetFailedError({ message: `Submodule operations failed:\n${messages.join("\n")}` })
    }

    const status = await Git.run(["status", "--porcelain=v1"], { cwd: worktreePath })
    if (status.exitCode !== 0) {
      throw new ResetFailedError({ message: status.text().trim() || "Failed to read git status" })
    }

    const dirty = status.text()
    if (!dirty) return true

    throw new ResetFailedError({ message: `Worktree reset left local changes:\n${dirty}` })
  }

  /**
   * List all worktrees in the current project.
   * Returns both the main worktree and any additional worktrees.
   */
  async function listImpl(ctx: InstanceContext) {
    if (ctx.project.vcs !== "git") {
      throw new NotGitError({ message: "Worktrees are only supported for git projects" })
    }
    return parseWorktrees(ctx)
  }
}
