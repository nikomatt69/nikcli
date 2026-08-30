import fs from "fs/promises"
import path from "path"
import { Context, Effect, Layer, Schema } from "effect"
import { Project } from "./project"
import { Worktree } from "@/worktree"
import { Slug } from "@nikcli-ai/util/slug"

export namespace ProjectCopy {
  export const Strategy = "git_worktree" as const

  const CreateInputSchema = Schema.Struct({
    projectID: Schema.String,
    strategy: Schema.Literal(Strategy),
    sourceDirectory: Schema.String,
    directory: Schema.String,
    name: Schema.optional(Schema.String),
  })
  export type CreateInput = Schema.Schema.Type<typeof CreateInputSchema>

  const RemoveInputSchema = Schema.Struct({
    projectID: Schema.String,
    directory: Schema.String,
    force: Schema.Boolean,
  })
  export type RemoveInput = Schema.Schema.Type<typeof RemoveInputSchema>

  export class CopyError extends Schema.TaggedError<CopyError>()("ProjectCopyError", {
    message: Schema.String,
    directory: Schema.optional(Schema.String),
    forceRequired: Schema.optional(Schema.Boolean),
  }) {}

  export interface Interface {
    create(input: CreateInput): Effect.Effect<{ directory: string }, CopyError | unknown>
    remove(input: RemoveInput): Effect.Effect<void, CopyError | unknown>
    refresh(input: { projectID: string }): Effect.Effect<{ updated: string[]; removed: string[] }, unknown>
  }

  export class Service extends Context.Service<Service, Interface>()("ProjectCopy.Service") {}

  async function canonical(directory: string) {
    return fs.realpath(directory).catch(() => path.resolve(directory))
  }

  /**
   * Mirrors the slug `Worktree.create` applies to `name`, so the free-name
   * search below and the directory git actually creates agree.
   */
  function slugify(input: string) {
    return input
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+/, "")
      .replace(/-+$/, "")
  }

  /**
   * opencode v2 escalation: `name`, then `name-2` … `name-10`, then give up.
   * `Worktree.create` would otherwise fall back to a random word pair, which
   * makes copy directories unpredictable.
   */
  async function freeName(root: string, base: string) {
    let suffix = 1
    let name = base
    while (
      await fs
        .stat(path.join(root, name))
        .then(() => true)
        .catch(() => false)
    ) {
      suffix++
      if (suffix > 10) return undefined
      name = `${base}-${suffix}`
    }
    return name
  }

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const project = yield* Project.Service
      const worktree = yield* Worktree.Service

      return Service.of({
        create: (input) =>
          Effect.gen(function* () {
            const sourceDirectory = yield* Effect.promise(() => canonical(input.sourceDirectory))
            const directories = yield* project.directories(input.projectID)
            if (!directories.some((item) => item.directory === sourceDirectory)) {
              return yield* new CopyError({
                message: "Source directory is not registered for this project",
                directory: sourceDirectory,
              })
            }
            yield* Effect.promise(() => fs.mkdir(input.directory, { recursive: true }))
            const base = slugify(input.name ?? Slug.create())
            const name = yield* Effect.promise(() => freeName(input.directory, base))
            if (!name) {
              return yield* new CopyError({
                message: `Destination already exists: ${path.join(input.directory, `${base}-10`)}`,
                directory: path.join(input.directory, `${base}-10`),
              })
            }
            const info = yield* worktree
              .create({
                root: input.directory,
                name,
                detached: true,
                sourceDirectory,
              })
              .pipe(
                Effect.catchTag("WorktreeCreateFailedError", (error) =>
                  Effect.fail(new CopyError({ message: error.message })),
                ),
              )
            yield* project.trackDirectory(input.projectID, info.directory, input.strategy, "replace")
            return { directory: info.directory }
          }),
        remove: (input) =>
          Effect.gen(function* () {
            const directory = yield* Effect.promise(() => canonical(input.directory))
            const directories = yield* project.directories(input.projectID)
            const stored = directories.find((item) => item.directory === directory)
            if (stored?.strategy !== Strategy) {
              return yield* new CopyError({
                message: "Directory is not a managed project copy",
                directory,
              })
            }
            yield* worktree.remove({ directory, force: input.force }).pipe(
              Effect.catchTag("WorktreeRemoveFailedError", (error) =>
                Effect.fail(
                  new CopyError({
                    message: error.message,
                    directory,
                    forceRequired: error.forceRequired,
                  }),
                ),
              ),
            )
            yield* project.removeSandbox(input.projectID, directory)
          }),
        refresh: (input) =>
          Effect.gen(function* () {
            const stored = yield* project.directories(input.projectID)
            const discovered = yield* worktree.list()
            const discoveredDirectories = new Set(discovered.map((item) => item.directory))
            const updated: string[] = []
            for (const item of discovered) {
              if (yield* project.trackDirectory(input.projectID, item.directory, Strategy, "replace")) {
                updated.push(item.directory)
              }
            }
            const removed: string[] = []
            for (const item of stored) {
              const exists = yield* Effect.promise(() =>
                fs
                  .stat(item.directory)
                  .then((stat) => stat.isDirectory())
                  .catch(() => false),
              )
              if (exists && (item.strategy !== Strategy || discoveredDirectories.has(item.directory))) continue
              if (!exists || item.strategy === Strategy) {
                if (yield* project.removeDirectory(input.projectID, item.directory)) removed.push(item.directory)
              }
            }
            return { updated, removed }
          }),
      })
    }),
  )

  export const defaultLayer = layer.pipe(
    Layer.provideMerge(Project.defaultLayer),
    Layer.provideMerge(Worktree.defaultLayer),
  )
}
