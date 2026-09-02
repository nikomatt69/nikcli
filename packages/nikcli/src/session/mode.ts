import z from "zod"
import { Config } from "../config/config"
import { Effect } from "effect"
import { AppRuntime, InstanceState, runPromiseWithLayer, withCurrentInstance } from "@/effect"
import { Instance } from "@/project/instance"
import { Provider } from "@/provider/provider"

export namespace Mode {
  export const Info = z
    .object({
      name: z.string(),
      temperature: z.number().optional(),
      topP: z.number().optional(),
      model: z
        .object({
          modelID: z.string(),
          providerID: z.string(),
        })
        .optional(),
      prompt: z.string().optional(),
      tools: z.record(z.string(), z.boolean()),
    })
    .meta({
      ref: "Mode",
    })
  export type Info = z.infer<typeof Info>

  const facade = InstanceState.make<Record<string, Info>>(() =>
    Effect.gen(function* () {
      const cfg = yield* Effect.promise(() =>
        runPromiseWithLayer(
          Config.defaultLayer,
          withCurrentInstance(
            Effect.gen(function* () {
              const config = yield* Config.Service
              return yield* config.get()
            }),
          ),
        ),
      )
      const model = cfg.model ? Provider.parseModel(cfg.model) : undefined
      const result: Record<string, Info> = {
        build: {
          model,
          name: "build",
          tools: {},
        },
        plan: {
          name: "plan",
          model,
          tools: {
            write: false,
            edit: false,
            patch: false,
          },
        },
      }
      for (const [key, value] of Object.entries(cfg.mode ?? {})) {
        if (value.disable) continue
        let item = result[key]
        if (!item)
          item = result[key] = {
            name: key,
            tools: {},
          }
        item.name = key
        if (value.model) item.model = Provider.parseModel(value.model)
        if (value.prompt) item.prompt = value.prompt
        if (value.temperature != undefined) item.temperature = value.temperature
        if (value.top_p != undefined) item.topP = value.top_p
        if (value.tools)
          item.tools = {
            ...value.tools,
            ...item.tools,
          }
      }
      return result
    }),
  )

  // Modes are derived from per-instance config, so the memo must be keyed by
  // instance — a single process can host several. `Instance.state` is the
  // keying, so the memo is also torn down with the instance it belongs to
  // instead of outliving it in a module-level map.
  //
  // NOTE: this slot, not the `facade` above, is the real memo — `load` builds
  // and disposes a fresh scoped cache per miss. That also means modes sit
  // outside instance hot reload: marking `facade` reloadable would register a
  // new cache per call and still never invalidate this slot. Reloading modes on
  // config change needs it cleared from an `instance.reloaded` subscription.
  const cache = Instance.state(() => ({ value: undefined as Record<string, Info> | undefined }))

  async function load() {
    const slot = cache()
    if (slot.value) return slot.value
    const effect = Effect.scoped(
      Effect.gen(function* () {
        const handle = yield* facade
        const value = yield* InstanceState.get(handle)
        return value
      }),
    )
    const value = await AppRuntime.runPromise(effect)
    slot.value = value
    return value
  }

  export async function get(mode: string) {
    const s = await load()
    return s[mode]
  }

  export async function list() {
    const s = await load()
    return Object.values(s)
  }
}
