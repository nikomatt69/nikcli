import { Log } from "../util/log"
import { Bom } from "../util/bom"
import path from "path"
import z from "zod"

import * as Formatter from "./formatter"
import { Config } from "../config/config"
import { mergeDeep } from "remeda"
import { InstanceState, locallyInstance, runPromiseWithLayer, withCurrentInstance } from "@/effect"
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
    /**
     * Runs the first matching formatter that succeeds for `filepath`.
     *
     * Ported from opencode #39564 (`feat(core): add V2 formatter runtime`):
     * formatters that match the file's extension are tried in order, and the
     * first one that exits 0 wins; a failing formatter falls through to the
     * next match. Returns `true` when a formatter ran successfully, `false`
     * when none did (disabled, no match, or every candidate failed).
     */
    readonly file: (filepath: string) => Effect.Effect<boolean>
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
          // opencode #39564: ruff and uv both format Python, so disabling one
          // disables both unless the other is explicitly re-enabled below.
          const configured = cfg.formatter ?? {}
          if (configured.ruff?.disabled || configured.uv?.disabled) {
            for (const name of ["ruff", "uv"]) delete formatters[name]
          }
          for (const [name, item] of Object.entries(configured)) {
            if (item.disabled) {
              delete formatters[name]
              continue
            }
            const builtIn = formatters[name]
            if (item.command) {
              // Explicit command overrides the built-in (or defines a new
              // formatter); detection is skipped and the command always runs.
              const result: Formatter.Info = mergeDeep(builtIn ?? {}, {
                command: [],
                extensions: [],
                ...item,
              })
              result.enabled = async () => true
              result.name = name
              formatters[name] = result
              continue
            }
            // No command: keep the built-in's detection and command, honoring
            // any extensions/environment overrides (opencode #39564).
            if (builtIn) {
              formatters[name] = {
                ...builtIn,
                extensions: item.extensions ?? builtIn.extensions,
                environment: item.environment
                  ? { ...(builtIn.environment ?? {}), ...item.environment }
                  : builtIn.environment,
              }
            } else {
              formatters[name] = {
                name,
                command: [],
                extensions: item.extensions ?? [],
                environment: item.environment,
                enabled: async () => false,
              }
            }
          }

          const s: State = {
            enabled,
            formatters,
            context: ctx,
          }

          return s
        }),
        // Pure derivation of config + files on disk, with no live resources
        // (formatting is invoked explicitly by the mutation tools via
        // `Format.formatFile`, so there is no subscription to lose), so this
        // state participates in config hot reload.
        { reloadable: true },
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

      const file = Effect.fn("Format.file")(function* (filepath: string) {
        const s = yield* InstanceState.get(state)
        return yield* Effect.promise(() => runFormatters(s, filepath))
      })

      return Service.of({
        init,
        status,
        file,
      })
    }),
  )

  export const defaultLayer = layer

  /**
   * Plain-async entrypoint used by write/edit/apply_patch.
   *
   * Runs the first successful matching formatter, then restores the BOM state
   * that existed immediately before formatting. Formatter failures are
   * non-fatal to the mutation, matching the existing formatter behavior.
   */
  export async function formatFile(filepath: string, bom: boolean): Promise<boolean> {
    const formatted = await runPromiseWithLayer(
      defaultLayer,
      withCurrentInstance(
        Effect.gen(function* () {
          const format = yield* Service
          return yield* format.file(filepath)
        }),
      ),
    ).catch((error) => {
      log.error("failed to format file", { error, file: filepath })
      return false
    })

    if (formatted) {
      await Bom.syncFile(filepath, bom).catch((error) =>
        log.error("failed to sync BOM after formatting", {
          error,
          file: filepath,
        }),
      )
    }
    return formatted
  }

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

  /**
   * Runs the first matching formatter that succeeds for `filepath`.
   *
   * Ported from opencode #39564: matching formatters are tried in order and
   * the first one that exits 0 wins; a formatter that fails (spawn error or
   * non-zero exit) falls through to the next match. Returns `true` when a
   * formatter ran successfully.
   */
  async function runFormatters(s: State, filepath: string): Promise<boolean> {
    const ext = path.extname(filepath)
    for (const item of await getFormatter(s, ext)) {
      const cmd = item.command.map((x) => x.replace("$FILE", filepath))
      log.info("formatting file", { file: filepath, command: cmd })
      try {
        const proc = Bun.spawn({
          windowsHide: true,
          cmd,
          cwd: s.context.directory,
          env: { ...process.env, ...item.environment },
          stdin: "ignore",
          stdout: "ignore",
          stderr: "ignore",
        })
        const exit = await proc.exited
        if (exit === 0) return true
        log.error("formatter exited unsuccessfully", {
          file: filepath,
          command: cmd,
          exitCode: exit,
          ...item.environment,
        })
      } catch (error) {
        log.error("failed to format file", {
          error,
          command: cmd,
          file: filepath,
          ...item.environment,
        })
      }
    }
    return false
  }
}
