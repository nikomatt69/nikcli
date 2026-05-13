import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import z from "zod"
import { Log } from "../util/log"
import { FileIgnore } from "./ignore"
import { Config } from "../config/config"
import path from "path"
// @ts-ignore
import { createWrapper } from "@parcel/watcher/wrapper"
import { lazy } from "@/util/lazy"
import { withTimeout } from "@/util/timeout"
import type ParcelWatcher from "@parcel/watcher"
import { $ } from "bun"
import { Flag } from "@/flag/flag"
import { readdir } from "fs/promises"
import { InstanceState, locallyInstance, runPromiseWithLayer, type InstanceContext } from "@/effect"
import { Context, Effect, Layer } from "effect"

const SUBSCRIBE_TIMEOUT_MS = 10_000

declare const NIKCLI_LIBC: string | undefined

export namespace FileWatcher {
  const log = Log.create({ service: "file.watcher" })

  export const Event = {
    Updated: BusEvent.define(
      "file.watcher.updated",
      z.object({
        file: z.string(),
        event: z.union([z.literal("add"), z.literal("change"), z.literal("unlink")]),
      }),
    ),
  }

  const watcher = lazy((): typeof import("@parcel/watcher") | undefined => {
    try {
      const binding = require(
        `@parcel/watcher-${process.platform}-${process.arch}${process.platform === "linux" ? `-${NIKCLI_LIBC || "glibc"}` : ""}`,
      )
      return createWrapper(binding) as typeof import("@parcel/watcher")
    } catch (error) {
      log.error("failed to load watcher binding", { error })
      return
    }
  })

  type State = {
    subs: ParcelWatcher.AsyncSubscription[]
  }

  export interface Interface {
    readonly init: () => Effect.Effect<void>
  }

  export class Service extends Context.Service<Service, Interface>()("@nikcli/FileWatcher") {}

  function configGet(ctx: InstanceContext) {
    return runPromiseWithLayer(
      Config.defaultLayer,
      locallyInstance(
        ctx,
        Effect.gen(function* () {
          const config = yield* Config.Service
          return yield* config.get()
        }),
      ),
    )
  }

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const state = yield* InstanceState.make<State>(
        Effect.fn("FileWatcher.state")(function* () {
          const ctx = yield* InstanceState.context
          if (ctx.project.vcs !== "git") return { subs: [] }

          log.info("init")
          const cfg = yield* Effect.promise(() => configGet(ctx))

          const backend = (() => {
            if (process.platform === "win32") return "windows"
            if (process.platform === "darwin") return "fs-events"
            if (process.platform === "linux") return "inotify"
          })()
          if (!backend) {
            log.error("watcher backend not supported", { platform: process.platform })
            return { subs: [] }
          }
          log.info("watcher backend", { platform: process.platform, backend })

          const w = watcher()
          if (!w) return { subs: [] }

          const subscribe: ParcelWatcher.SubscribeCallback = (err, evts) => {
            if (err) return
            for (const evt of evts) {
              if (evt.type === "create") Bus.publish(Event.Updated, { file: evt.path, event: "add" })
              if (evt.type === "update") Bus.publish(Event.Updated, { file: evt.path, event: "change" })
              if (evt.type === "delete") Bus.publish(Event.Updated, { file: evt.path, event: "unlink" })
            }
          }

          const subs: ParcelWatcher.AsyncSubscription[] = []
          const cfgIgnores = cfg.watcher?.ignore ?? []

          if (Flag.NIKCLI_EXPERIMENTAL_FILEWATCHER) {
            const pending = w.subscribe(ctx.directory, subscribe, {
              ignore: [...FileIgnore.PATTERNS, ...cfgIgnores],
              backend,
            })
            const sub = yield* Effect.promise(() =>
              withTimeout(pending, SUBSCRIBE_TIMEOUT_MS).catch((err) => {
                log.error("failed to subscribe to directory", { error: err })
                pending.then((s) => s.unsubscribe()).catch(() => {})
                return undefined
              }),
            )
            if (sub) subs.push(sub)
          }

          const vcsDir = yield* Effect.promise(() =>
            $`git rev-parse --git-dir`
              .quiet()
              .nothrow()
              .cwd(ctx.worktree)
              .text()
              .then((x) => path.resolve(ctx.worktree, x.trim()))
              .catch(() => undefined),
          )
          if (vcsDir && !cfgIgnores.includes(".git") && !cfgIgnores.includes(vcsDir)) {
            const gitDirContents = yield* Effect.promise(() => readdir(vcsDir).catch(() => []))
            const ignoreList = gitDirContents.filter((entry) => entry !== "HEAD")
            const pending = w.subscribe(vcsDir, subscribe, {
              ignore: ignoreList,
              backend,
            })
            const sub = yield* Effect.promise(() =>
              withTimeout(pending, SUBSCRIBE_TIMEOUT_MS).catch((err) => {
                log.error("failed to subscribe to vcsDir", { error: err })
                pending.then((s) => s.unsubscribe()).catch(() => {})
                return undefined
              }),
            )
            if (sub) subs.push(sub)
          }

          yield* Effect.addFinalizer(() => Effect.promise(() => Promise.all(subs.map((sub) => sub.unsubscribe()))))

          return { subs }
        }),
      )

      const init = Effect.fn("FileWatcher.init")(function* () {
        if (Flag.NIKCLI_EXPERIMENTAL_DISABLE_FILEWATCHER) return
        yield* InstanceState.get(state)
      })

      return Service.of({ init })
    }),
  )

  export const defaultLayer = layer
}
