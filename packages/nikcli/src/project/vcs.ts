import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import z from "zod"
import { Log } from "@/util/log"
import { FileWatcher } from "@/file/watcher"
import { Git } from "@/git"
import { InstanceState } from "@/effect"
import { Context, Effect, Layer } from "effect"

const log = Log.create({ service: "vcs" })

export namespace Vcs {
  export const Event = {
    BranchUpdated: BusEvent.define(
      "vcs.branch.updated",
      z.object({
        branch: z.string().optional(),
      }),
    ),
  }

  export const Info = z
    .object({
      branch: z.string(),
    })
    .meta({
      ref: "VcsInfo",
    })
  export type Info = z.infer<typeof Info>

  type State = {
    branch: () => Promise<string | undefined>
  }

  export interface Interface {
    readonly init: () => Effect.Effect<void>
    readonly branch: () => Effect.Effect<string | undefined>
  }

  export class Service extends Context.Tag("@nikcli/Vcs")<Service, Interface>() {}

  export const layer = Layer.scoped(
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

          const unsubscribe = Bus.subscribe(FileWatcher.Event.Updated, async (evt) => {
            if (evt.properties.file.endsWith("HEAD")) return
            const next = await currentBranch()
            if (next !== current) {
              log.info("branch changed", { from: current, to: next })
              current = next
              Bus.publish(Event.BranchUpdated, { branch: next })
            }
          })

          yield* Effect.addFinalizer(() => Effect.sync(() => unsubscribe()))

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

      return Service.of({
        init,
        branch,
      })
    }),
  )

  export const defaultLayer = layer
}
