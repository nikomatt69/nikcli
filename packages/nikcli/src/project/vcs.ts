import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import z from "zod"
import { Log } from "@/util/log"
import { FileWatcher } from "@/file/watcher"
import { Git } from "@/git"
import { InstanceState } from "@/effect"
import { zodObject } from "@/util/effect-zod"
import { throttleTrailing } from "@/util/throttle"
import { Context, Effect, Layer, Schema } from "effect"

const log = Log.create({ service: "vcs" })

export namespace Vcs {
  export const Event = {
    BranchUpdated: BusEvent.schema(
      "vcs.branch.updated",
      Schema.Struct({
        branch: Schema.optional(Schema.String),
      }),
    ),
  }

  export const InfoSchema = Schema.Struct({
    branch: Schema.String,
  }).annotate({ identifier: "VcsInfo" })
  export const Info = zodObject(InfoSchema)
  export type Info = Schema.Schema.Type<typeof InfoSchema>

  export const FileStatusSchema = Schema.Struct({
    file: Schema.String,
    additions: Schema.Number,
    deletions: Schema.Number,
    status: Schema.Literals(["added", "deleted", "modified"]),
  }).annotate({ identifier: "VcsFileStatus" })
  export const FileStatus = zodObject(FileStatusSchema)
  export type FileStatus = Schema.Schema.Type<typeof FileStatusSchema>

  export const ApplyInputSchema = Schema.Struct({
    patch: Schema.String,
  }).annotate({ identifier: "VcsApplyInput" })
  export const ApplyInput = zodObject(ApplyInputSchema)
  export type ApplyInput = Schema.Schema.Type<typeof ApplyInputSchema>

  export const ApplyResultSchema = Schema.Struct({
    applied: Schema.Boolean,
  }).annotate({ identifier: "VcsApplyResult" })
  export const ApplyResult = zodObject(ApplyResultSchema)
  export type ApplyResult = Schema.Schema.Type<typeof ApplyResultSchema>

  export class PatchApplyError extends Schema.TaggedErrorClass<PatchApplyError>()("VcsPatchApplyError", {
    message: Schema.String,
    reason: Schema.Literals(["non-git", "not-clean"]),
  }) {}

  type State = {
    branch: () => Promise<string | undefined>
  }

  export interface Interface {
    readonly init: () => Effect.Effect<void>
    readonly branch: () => Effect.Effect<string | undefined>
    readonly status: () => Effect.Effect<FileStatus[]>
    readonly diffRaw: () => Effect.Effect<string>
    readonly apply: (input: ApplyInput) => Effect.Effect<ApplyResult, PatchApplyError>
  }

  export class Service extends Context.Service<Service, Interface>()("@nikcli/Vcs") {}

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const state = yield* InstanceState.make<State>(
        Effect.fn("Vcs.state")(function* () {
          const ctx = yield* InstanceState.context
          if (ctx.project.vcs !== "git") {
            return { branch: async () => undefined }
          }

          const currentBranch = () => Git.branch(ctx.worktree)
          let current = yield* Effect.promise(() => currentBranch())
          log.info("initialized", { branch: current })

          // The current branch only changes when `.git/HEAD` is rewritten.
          // Reacting to every file event spawned a `git branch` subprocess per
          // save — a process storm under active editing or a build watcher.
          // Gate strictly on HEAD and debounce so rapid rewrites (rebase,
          // checkout) collapse into a single check.
          const refreshBranch = throttleTrailing(() => {
            void currentBranch()
              .then((next) => {
                if (next === current) return
                log.info("branch changed", { from: current, to: next })
                current = next
                Bus.publish(Event.BranchUpdated, { branch: next })
              })
              .catch(() => undefined)
          }, 250)
          const unsubscribe = Bus.subscribe(FileWatcher.Event.Updated, (evt) => {
            if (!evt.properties.file.endsWith("HEAD")) return
            refreshBranch.call()
          })

          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              refreshBranch.cancel()
              unsubscribe()
            }),
          )

          return {
            branch: async () => current,
          }
        }),
      )

      const init = Effect.fn("Vcs.init")(function* () {
        yield* InstanceState.get(state)
      })

      const branch = Effect.fn("Vcs.branch")(function* () {
        const s = yield* InstanceState.get(state)
        return yield* Effect.promise(() => s.branch())
      })

      const status = Effect.fn("Vcs.status")(function* () {
        const ctx = yield* InstanceState.context
        if (ctx.project.vcs !== "git") return []

        const [hasHead, list] = yield* Effect.all(
          [Effect.promise(() => Git.hasHead(ctx.directory)), Effect.promise(() => Git.status(ctx.directory))],
          { concurrency: 2 },
        )
        const stats = hasHead ? yield* Effect.promise(() => Git.stats(ctx.directory, "HEAD")) : []
        const statsByFile = new Map(stats.map((item) => [item.file, item]))

        const untracked = list.filter((item) => item.code === "??")
        const untrackedStats =
          untracked.length > 0
            ? yield* Effect.forEach(
                untracked,
                (item) =>
                  Effect.promise(() =>
                    Git.statUntracked(ctx.directory, item.file).then((stat) => ({
                      file: item.file,
                      stat,
                    })),
                  ),
                { concurrency: "unbounded" },
              )
            : []
        const untrackedByFile = new Map(untrackedStats.map(({ file, stat }) => [file, stat]))

        return list
          .toSorted((a, b) => a.file.localeCompare(b.file))
          .map((item) => {
            const stat = statsByFile.get(item.file) ?? untrackedByFile.get(item.file)
            return {
              file: item.file,
              additions: stat?.additions ?? 0,
              deletions: stat?.deletions ?? 0,
              status: item.status,
            } satisfies FileStatus
          })
      })

      const diffRaw = Effect.fn("Vcs.diffRaw")(function* () {
        const ctx = yield* InstanceState.context
        if (ctx.project.vcs !== "git") return ""

        const [hasHead, list] = yield* Effect.all(
          [Effect.promise(() => Git.hasHead(ctx.directory)), Effect.promise(() => Git.status(ctx.directory))],
          { concurrency: 2 },
        )
        const tracked = hasHead ? (yield* Effect.promise(() => Git.patchAll(ctx.directory, "HEAD"))).text : ""
        const untracked = yield* Effect.forEach(
          list.filter((item) => item.code === "??"),
          (item) => Effect.promise(() => Git.patchUntracked(ctx.directory, item.file).then((patch) => patch.text)),
        )
        return [tracked, ...untracked].filter(Boolean).join("\n")
      })

      const apply = Effect.fn("Vcs.apply")(function* (input: ApplyInput) {
        const ctx = yield* InstanceState.context
        if (ctx.project.vcs !== "git") {
          return yield* new PatchApplyError({
            message: "Patch can't be applied because the project is not git-based",
            reason: "non-git",
          })
        }

        const applied = yield* Effect.promise(() => Git.applyPatch(ctx.directory, input.patch))
        if (applied.exitCode !== 0) {
          return yield* new PatchApplyError({
            message: "Patch can't be applied",
            reason: "not-clean",
          })
        }
        return { applied: true }
      })

      return Service.of({
        init,
        branch,
        status,
        diffRaw,
        apply,
      })
    }),
  )

  export const defaultLayer = layer
}
