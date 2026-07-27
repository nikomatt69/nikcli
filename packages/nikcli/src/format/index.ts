import { Bus } from "../bus"
import { File } from "../file"
import { Log } from "../util/log"
import path from "path"
import z from "zod"

import * as Formatter from "./formatter"
import { Config } from "../config/config"
import { mergeDeep } from "remeda"
import { InstanceState, locallyInstance, runPromiseWithLayer } from "@/effect"
import type { InstanceContext } from "@/effect/instance-ref"
import { Context, Effect, Layer } from "effect"

export namespace Format {
  const log = Log.create({ service: "format" })

  export const Status = z
    .object({
      name: z.string(),
      extensions: z.string().array(),
      enabled: z.boolean(),
    })
    .meta({
      ref: "FormatterStatus",
    })
  export type Status = z.infer<typeof Status>

  type State = {
    enabled: Record<string, boolean>
    formatters: Record<string, Formatter.Info>
    context: InstanceContext
  }

  export interface Interface {
    readonly init: () => Effect.Effect<void>
    readonly status: () => Effect.Effect<Status[]>
  }

  export class Service extends Context.Service<Service, Interface>()("@nikcli/Format") {}

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
        Effect.fn("Format.state")(function* () {
          const ctx = yield* InstanceState.context
          const enabled: Record<string, boolean> = {}
          const cfg = yield* Effect.promise(() => configGet(ctx))

          const formatters: Record<string, Formatter.Info> = {}
          if (cfg.formatter === false) {
            log.info("all formatters are disabled")
            return {
              enabled,
              formatters,
              context: ctx,
            }
          }

          for (const item of Object.values(Formatter)) {
            if (!("name" in item)) continue
            formatters[item.name] = item
          }
          for (const [name, item] of Object.entries(cfg.formatter ?? {})) {
            if (item.disabled) {
              delete formatters[name]
              continue
            }
            const result: Formatter.Info = mergeDeep(formatters[name] ?? {}, {
              command: [],
              extensions: [],
              ...item,
            })

            if (result.command.length === 0) continue

            result.enabled = async () => true
            result.name = name
            formatters[name] = result
          }

          const s: State = {
            enabled,
            formatters,
            context: ctx,
          }

          const unsubscribe = Bus.subscribe(File.Event.Edited, async (payload) => {
            const file = payload.properties.file
            log.info("formatting", { file })
            const ext = path.extname(file)

            for (const item of await getFormatter(s, ext)) {
              log.info("running", { command: item.command })
              try {
                const proc = Bun.spawn({
                  cmd: item.command.map((x) => x.replace("$FILE", file)),
                  cwd: ctx.directory,
                  env: { ...process.env, ...item.environment },
                  stdout: "ignore",
                  stderr: "ignore",
                })
                const exit = await proc.exited
                if (exit !== 0)
                  log.error("failed", {
                    command: item.command,
                    ...item.environment,
                  })
              } catch (error) {
                log.error("failed to format file", {
                  error,
                  command: item.command,
                  ...item.environment,
                  file,
                })
              }
            }
          })

          yield* Effect.addFinalizer(() => Effect.sync(() => unsubscribe()))

          return s
        }),
        // Deliberately not `reloadable`: this state owns the live subscription
        // that runs formatters on file edits. Invalidation would unsubscribe and
        // only resubscribe on the next access, which may never come, so
        // auto-format would stop silently. Formatter config needs a restart.
      )

      const init = Effect.fn("Format.init")(function* () {
        log.info("init")
        yield* InstanceState.get(state)
      })

      const status = Effect.fn("Format.status")(function* () {
        const s = yield* InstanceState.get(state)
        const result: Status[] = []
        for (const formatter of Object.values(s.formatters)) {
          const enabled = yield* Effect.promise(() => isEnabled(s, formatter))
          result.push({
            name: formatter.name,
            extensions: formatter.extensions,
            enabled,
          })
        }
        return result
      })

      return Service.of({
        init,
        status,
      })
    }),
  )

  export const defaultLayer = layer

  async function isEnabled(s: State, item: Formatter.Info) {
    let status = s.enabled[item.name]
    if (status === undefined) {
      status = await item.enabled(s.context)
      s.enabled[item.name] = status
    }
    return status
  }

  async function getFormatter(s: State, ext: string) {
    const result = []
    for (const item of Object.values(s.formatters)) {
      log.info("checking", { name: item.name, ext })
      if (!item.extensions.includes(ext)) continue
      if (!(await isEnabled(s, item))) continue
      log.info("enabled", { name: item.name, ext })
      result.push(item)
    }
    return result
  }
}
