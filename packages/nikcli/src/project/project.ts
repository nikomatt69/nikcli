import fs from "fs/promises"
import { Filesystem } from "../util/filesystem"
import path from "path"
import { Storage } from "../storage/storage"
import { Log } from "../util/log"
import { Flag } from "@/flag/flag"
import { BusEvent } from "@/bus/bus-event"
import { iife } from "@/util/iife"
import { GlobalBus } from "@/bus/global"
import { existsSync } from "fs"
import { Git } from "@/git"
import { type DeepMutable, zodObject } from "@/util/effect-zod"
import { Context, Effect, Layer, Schema } from "effect"
import { storageList, storageRead, storageRemove, storageUpdate, storageWrite } from "@/storage/effect"
import { Hash } from "@/util/hash"
import { Lock } from "@/util/lock"

export namespace Project {
  const log = Log.create({ service: "project" })

  async function readCachedID(gitDir?: string) {
    if (!gitDir) return undefined

    const stat = await fs.stat(gitDir).catch(() => undefined)
    if (!stat?.isDirectory()) return undefined

    return Bun.file(path.join(gitDir, "nikcli"))
      .text()
      .then((x) => x.trim())
      .catch(() => undefined)
  }

  async function writeCachedID(gitDir: string | undefined, id: string) {
    if (!gitDir) return

    const stat = await fs.stat(gitDir).catch(() => undefined)
    if (!stat?.isDirectory()) return

    await Bun.file(path.join(gitDir, "nikcli"))
      .write(id)
      .catch(() => undefined)
  }

  function cacheDirToWorktree(gitDir: string, sandbox: string) {
    const dirname = path.dirname(path.relative(sandbox, gitDir) || ".")
    if (dirname === ".") return sandbox
    return path.resolve(sandbox, dirname)
  }

  const IconSchema = Schema.Struct({
    url: Schema.optional(Schema.String),
    override: Schema.optional(Schema.String),
    color: Schema.optional(Schema.String),
  })

  const InfoSchema = Schema.Struct({
    id: Schema.String,
    worktree: Schema.String,
    canonical: Schema.String,
    vcs: Schema.optional(Schema.Literal("git")),
    name: Schema.optional(Schema.String),
    icon: Schema.optional(IconSchema),
    commands: Schema.optional(
      Schema.Struct({
        start: Schema.optional(Schema.String),
      }),
    ),
    time: Schema.Struct({
      created: Schema.Number,
      updated: Schema.Number,
      initialized: Schema.optional(Schema.Number),
    }),
    sandboxes: Schema.mutable(Schema.Array(Schema.String)),
  }).annotate({ identifier: "Project" })
  export const Info = zodObject(InfoSchema)
  // The Project service mutates `Info` records during merge/update flows. `DeepMutable` strips
  // readonly so those internal mutations type-check; the wire format is still emitted via
  // `zodObject` / walker-derived JSON Schema.
  export type Info = DeepMutable<Schema.Schema.Type<typeof InfoSchema>>

  const DirectorySchema = Schema.Struct({
    directory: Schema.String,
    strategy: Schema.optional(Schema.String),
  }).annotate({ identifier: "ProjectDirectory" })
  export const Directory = zodObject(DirectorySchema)
  export type Directory = Schema.Schema.Type<typeof DirectorySchema>

  const DirectoriesUpdatedSchema = Schema.Struct({
    projectID: Schema.String,
  }).annotate({ identifier: "ProjectDirectoriesUpdated" })

  export const Event = {
    Updated: BusEvent.schema("project.updated", InfoSchema),
    DirectoriesUpdated: BusEvent.schema("project.directories.updated", DirectoriesUpdatedSchema),
  }

  const UpdateInputSchema = Schema.Struct({
    projectID: Schema.String,
    name: Schema.optional(Schema.String),
    icon: Schema.optional(IconSchema),
  })
  export const UpdateInput = zodObject(UpdateInputSchema)
  export type UpdateInput = Schema.Schema.Type<typeof UpdateInputSchema>

  export interface Interface {
    fromDirectory(directory: string): Effect.Effect<{ project: Info; sandbox: string }, unknown>
    discover(input: Info): Effect.Effect<void, unknown>
    setInitialized(projectID: string): Effect.Effect<void, unknown>
    list(): Effect.Effect<Info[], unknown>
    update(input: UpdateInput): Effect.Effect<Info, unknown>
    directories(projectID: string): Effect.Effect<Directory[], unknown>
    trackDirectory(
      projectID: string,
      directory: string,
      strategy?: string,
      behavior?: "ignore" | "replace",
    ): Effect.Effect<boolean, unknown>
    removeDirectory(projectID: string, directory: string): Effect.Effect<boolean, unknown>
    sandboxes(projectID: string): Effect.Effect<string[], unknown>
    removeSandbox(projectID: string, directory: string): Effect.Effect<Info, unknown>
  }

  export class Service extends Context.Service<Service, Interface>()("Project.Service") {}

  function remoteIdentity(input: string) {
    const value = input.trim()
    if (!value) return undefined
    let host = ""
    let pathname = ""
    try {
      const parsed = new URL(value)
      if (parsed.protocol === "file:") return undefined
      host = parsed.hostname
      pathname = parsed.pathname
    } catch {
      const scp = value.match(/^([^@/:]+@)?([^/:]+):(.+)$/)
      if (!scp) return undefined
      host = scp[2] ?? ""
      pathname = scp[3] ?? ""
    }
    pathname = pathname
      .replace(/^\/+/, "")
      .replace(/\.git\/?$/, "")
      .replace(/\/+$/, "")
    if (!host || !pathname) return undefined
    return Hash.fast(`git-remote:${host.toLowerCase()}/${pathname}`)
  }

  async function canonicalDirectory(directory: string) {
    return fs.realpath(directory).catch(() => path.resolve(directory))
  }

  function directoryKey(projectID: string) {
    return ["project_directory", projectID]
  }

  async function readDirectories(projectID: string): Promise<Directory[]> {
    const stored = await storageRead<Directory[]>(directoryKey(projectID)).catch(() => undefined)
    if (stored) return stored
    const project = await storageRead<Info>(["project", projectID]).catch(() => undefined)
    if (!project) return []
    const canonical = await canonicalDirectory(project.canonical ?? project.worktree)
    const items: Directory[] = [{ directory: canonical }]
    for (const sandbox of project.sandboxes ?? []) {
      const directory = await canonicalDirectory(sandbox)
      if (directory !== canonical) items.push({ directory, strategy: "git_worktree" })
    }
    await storageWrite(directoryKey(projectID), items)
    return items
  }

  async function trackDirectoryImpl(
    projectID: string,
    input: string,
    strategy?: string,
    behavior: "ignore" | "replace" = "ignore",
  ) {
    using _ = await Lock.write(`project-directory:${projectID}`)
    const directory = await canonicalDirectory(input)
    const items = await readDirectories(projectID)
    const index = items.findIndex((item) => item.directory === directory)
    if (index >= 0) {
      if (behavior !== "replace" || items[index]?.strategy === strategy) return false
      items[index] = { directory, ...(strategy ? { strategy } : {}) }
    } else {
      items.push({ directory, ...(strategy ? { strategy } : {}) })
    }
    await storageWrite(directoryKey(projectID), items)
    return true
  }

  async function removeDirectoryImpl(projectID: string, input: string) {
    using _ = await Lock.write(`project-directory:${projectID}`)
    const directory = await canonicalDirectory(input)
    const items = await readDirectories(projectID)
    const next = items.filter((item) => item.directory !== directory)
    if (next.length === items.length) return false
    await storageWrite(directoryKey(projectID), next)
    return true
  }

  async function fromDirectoryImpl(directory: string) {
    log.info("fromDirectory", { directory })

    const { id, sandbox, worktree, vcs } = await iife(async () => {
      let topResult: string | undefined
      const matches = Filesystem.up({ targets: [".git"], start: directory })
      const git = await matches.next().then((x) => x.value)
      await matches.return()
      if (git) {
        let sandbox = path.dirname(git)

        const gitBinary = Bun.which("git")

        // Parallelize initial operations: git binary check + cache read
        const [cachedId, commonGitDirResult, remoteResult] = await Promise.all([
          readCachedID(git),
          gitBinary
            ? Git.run(["rev-parse", "--git-common-dir"], { cwd: sandbox })
                .then((result) => (result.exitCode === 0 ? path.resolve(sandbox, result.text().trim()) : undefined))
                .catch(() => undefined)
            : Promise.resolve(undefined),
          gitBinary
            ? Git.run(["remote", "get-url", "origin"], { cwd: sandbox })
                .then((result) => (result.exitCode === 0 ? remoteIdentity(result.text()) : undefined))
                .catch(() => undefined)
            : Promise.resolve(undefined),
        ])

        let commonGitDir = commonGitDirResult
        let id = remoteResult ?? cachedId

        if (!id && commonGitDir && commonGitDir !== git) {
          id = await readCachedID(commonGitDir)
        }

        if (!gitBinary) {
          return {
            id: id ?? "global",
            worktree: sandbox,
            sandbox: sandbox,
            vcs: Info.shape.vcs.parse(Flag.NIKCLI_FAKE_VCS),
          }
        }

        if (!id) {
          // Parallelize: rev-list + rev-parse --show-toplevel
          const [rootsResult, top] = await Promise.all([
            Git.run(["rev-list", "--max-parents=0", "--all"], { cwd: sandbox })
              .then((result) => {
                if (result.exitCode !== 0) return undefined
                return result
                  .text()
                  .split("\n")
                  .filter(Boolean)
                  .map((item) => item.trim())
                  .toSorted()
              })
              .catch(() => undefined),
            Git.run(["rev-parse", "--show-toplevel"], { cwd: sandbox })
              .then((result) => (result.exitCode === 0 ? path.resolve(sandbox, result.text().trim()) : undefined))
              .catch(() => undefined),
          ])
          topResult = top

          if (!rootsResult) {
            return {
              id: "global",
              worktree: sandbox,
              sandbox: sandbox,
              vcs: Info.shape.vcs.parse(Flag.NIKCLI_FAKE_VCS),
            }
          }

          id = rootsResult[0]
          if (id) {
            const derivedID = id
            const cacheDir = commonGitDir ?? git
            void readCachedID(cacheDir)
              .then((cached) => {
                if (cached || !cacheDir) return
                return writeCachedID(cacheDir, derivedID)
              })
              .catch(() => undefined)
          }

          if (!id) {
            return {
              id: "global",
              worktree: sandbox,
              sandbox: sandbox,
              vcs: "git",
            }
          }

          // If we have top from the parallel call, use it
          if (topResult) {
            sandbox = topResult
            const worktree = commonGitDir ? cacheDirToWorktree(commonGitDir, sandbox) : undefined
            if (worktree) {
              return {
                id,
                sandbox,
                worktree,
                vcs: "git",
              }
            }
            return {
              id,
              sandbox,
              worktree: sandbox,
              vcs: Info.shape.vcs.parse(Flag.NIKCLI_FAKE_VCS),
            }
          }
        }

        // Parallelize: rev-parse --show-toplevel + (cache read if needed)
        const needsTop = !topResult
        const [top, _idCheck] = await Promise.all([
          Git.run(["rev-parse", "--show-toplevel"], { cwd: sandbox })
            .then((result) => (result.exitCode === 0 ? path.resolve(sandbox, result.text().trim()) : undefined))
            .catch(() => undefined),
          needsTop && !id ? readCachedID(git) : Promise.resolve(id),
        ])
        // Update topResult for any subsequent use
        topResult = top

        // Use top from this call, falling back to topResult from earlier parallel call
        const finalTop = top ?? topResult

        if (!finalTop) {
          return {
            id: id ?? "global",
            sandbox,
            worktree: sandbox,
            vcs: Info.shape.vcs.parse(Flag.NIKCLI_FAKE_VCS),
          }
        }

        sandbox = finalTop

        const worktree = commonGitDir ? cacheDirToWorktree(commonGitDir, sandbox) : undefined

        if (!worktree) {
          return {
            id: id ?? "global",
            sandbox,
            worktree: sandbox,
            vcs: Info.shape.vcs.parse(Flag.NIKCLI_FAKE_VCS),
          }
        }

        return {
          id: id ?? "global",
          sandbox,
          worktree,
          vcs: "git",
        }
      }

      return {
        id: "global",
        worktree: "/",
        sandbox: "/",
        vcs: Info.shape.vcs.parse(Flag.NIKCLI_FAKE_VCS),
      }
    })

    let existing = await storageRead<Info>(["project", id]).catch(() => undefined)
    if (!existing) {
      existing = {
        id,
        worktree,
        canonical: worktree,
        vcs: vcs as Info["vcs"],
        sandboxes: [],
        time: {
          created: Date.now(),
          updated: Date.now(),
        },
      }
      if (id !== "global") {
        await migrateFromGlobal(id, worktree)
      }
    }

    if (!existing.sandboxes) existing.sandboxes = []

    if (Flag.NIKCLI_EXPERIMENTAL_ICON_DISCOVERY) {
      void discoverImpl(existing).catch((error) => {
        log.warn("icon discovery failed", { directory, error })
      })
    }

    const result: Info = {
      ...existing,
      worktree,
      canonical: worktree,
      vcs: vcs as Info["vcs"],
      time: {
        ...existing.time,
        updated: Date.now(),
      },
    }
    if (sandbox !== result.worktree && !result.sandboxes.includes(sandbox)) result.sandboxes.push(sandbox)
    result.sandboxes = result.sandboxes.filter((x: string) => existsSync(x))
    await storageWrite<Info>(["project", id], result)
    await trackDirectoryImpl(id, worktree)
    if (sandbox !== worktree) await trackDirectoryImpl(id, sandbox, vcs === "git" ? "git_worktree" : undefined)
    GlobalBus.emit("event", {
      payload: {
        type: Event.Updated.type,
        properties: result,
      },
    })
    return { project: result, sandbox }
  }

  async function discoverImpl(input: Info) {
    if (input.vcs !== "git") return
    if (input.icon?.override) return
    if (input.icon?.url) return
    const glob = new Bun.Glob("**/{favicon}.{ico,png,svg,jpg,jpeg,webp}")
    const matches = await Array.fromAsync(
      glob.scan({
        cwd: input.worktree,
        absolute: true,
        onlyFiles: true,
        followSymlinks: false,
        dot: false,
      }),
    )
    const shortest = matches.sort((a, b) => a.length - b.length)[0]
    if (!shortest) return
    const file = Bun.file(shortest)
    const buffer = await file.arrayBuffer()
    const base64 = Buffer.from(buffer).toString("base64")
    const mime = file.type || "image/png"
    const url = `data:${mime};base64,${base64}`
    await updateImpl({
      projectID: input.id,
      icon: {
        url,
      },
    })
    return
  }

  async function migrateFromGlobal(newProjectID: string, worktree: string) {
    const globalProject = await storageRead<Info>(["project", "global"]).catch(() => undefined)
    if (!globalProject) return

    // Lazy: the session repo pulls the drizzle/database chain, which client
    // processes loading project.ts must not evaluate at module load.
    const { SessionRepo } = await import("../session/repo")
    const globalSessions = SessionRepo.getByProject("global")
    if (globalSessions.length === 0) return

    log.info("migrating sessions from global", {
      newProjectID,
      worktree,
      count: globalSessions.length,
    })

    try {
      for (const session of globalSessions) {
        if (session.directory && session.directory !== worktree) continue
        log.info("migrating session", {
          sessionID: session.id,
          from: "global",
          to: newProjectID,
        })
        SessionRepo.upsert({ ...session, projectID: newProjectID })
      }
    } catch (error) {
      log.error("failed to migrate sessions from global to project", {
        error,
        projectId: newProjectID,
      })
    }
  }

  async function setInitializedImpl(projectID: string) {
    await storageUpdate<Info>(["project", projectID], (draft) => {
      draft.time.initialized = Date.now()
    })
  }

  async function listImpl() {
    const keys = await storageList(["project"])
    const projects = await Promise.all(keys.map((x) => storageRead<Info>(x)))
    return projects.map((project: Info) => ({
      ...project,
      canonical: project.canonical ?? project.worktree,
      sandboxes: project.sandboxes?.filter((x: string) => existsSync(x)),
    }))
  }

  async function updateImpl(input: UpdateInput) {
    const result = await storageUpdate<Info>(["project", input.projectID], (draft) => {
      if (input.name !== undefined) draft.name = input.name
      if (input.icon !== undefined) {
        draft.icon = {
          ...draft.icon,
        }
        if (input.icon.url !== undefined) draft.icon.url = input.icon.url
        if (input.icon.override !== undefined) draft.icon.override = input.icon.override || undefined
        if (input.icon.color !== undefined) draft.icon.color = input.icon.color
      }
      draft.time.updated = Date.now()
    })
    GlobalBus.emit("event", {
      payload: {
        type: Event.Updated.type,
        properties: result,
      },
    })
    return result
  }

  async function sandboxesImpl(projectID: string) {
    const project = await storageRead<Info>(["project", projectID]).catch(() => undefined)
    if (!project) return []
    const canonical = await canonicalDirectory(project.canonical ?? project.worktree)
    const valid: string[] = []
    for (const item of await readDirectories(projectID)) {
      const dir = item.directory
      if (dir === canonical) continue
      const stat = await fs.stat(dir).catch(() => undefined)
      if (stat?.isDirectory()) valid.push(dir)
    }
    return valid
  }

  async function removeSandboxImpl(projectID: string, directory: string) {
    await removeDirectoryImpl(projectID, directory)
    const result = await storageUpdate<Info>(["project", projectID], (draft) => {
      const sandboxes = draft.sandboxes ?? []
      draft.sandboxes = sandboxes.filter((sandbox: string) => sandbox !== directory)
      draft.time.updated = Date.now()
    })
    GlobalBus.emit("event", {
      payload: {
        type: Event.Updated.type,
        properties: result,
      },
    })
    return result
  }

  const layer = Layer.succeed(
    Service,
    Service.of({
      fromDirectory: (directory) => Effect.tryPromise(() => fromDirectoryImpl(directory)),
      discover: (input) => Effect.tryPromise(() => discoverImpl(input)),
      setInitialized: (projectID) => Effect.tryPromise(() => setInitializedImpl(projectID)),
      list: () => Effect.tryPromise(() => listImpl()),
      update: (input) => Effect.tryPromise(() => updateImpl(input)),
      directories: (projectID) => Effect.tryPromise(() => readDirectories(projectID)),
      trackDirectory: (projectID, directory, strategy, behavior) =>
        Effect.tryPromise(() => trackDirectoryImpl(projectID, directory, strategy, behavior)),
      removeDirectory: (projectID, directory) => Effect.tryPromise(() => removeDirectoryImpl(projectID, directory)),
      sandboxes: (projectID) => Effect.tryPromise(() => sandboxesImpl(projectID)),
      removeSandbox: (projectID, directory) => Effect.tryPromise(() => removeSandboxImpl(projectID, directory)),
    }),
  )

  export const defaultLayer = layer
}
