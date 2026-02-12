import { Global } from "../global"
import { Log } from "../util/log"
import path from "path"
import z from "zod"
import { data } from "./models-macro" with { type: "macro" }
import { Installation } from "../installation"
import { Flag } from "../flag/flag"

export namespace ModelsDev {
  const log = Log.create({ service: "models.dev" })
  const filepath = path.join(Global.Path.cache, "models.json")

  function ensureModel(database: Record<string, Provider>, providerID: string, modelID: string, model: Model) {
    const provider = database[providerID]
    if (!provider) return
    if (!provider.models) return
    if (provider.models[modelID]) return
    provider.models[modelID] = model
  }

  function patch(database: Record<string, Provider>): Record<string, Provider> {
    // MiniMax M2.5 (models.dev PR #875)
    const releaseDate = "2026-02-12"
    const limit = {
      context: 204_800,
      output: 131_072,
    }
    const modalities: NonNullable<Model["modalities"]> = {
      input: ["text"],
      output: ["text"],
    }

    const minimaxM25Paid: Model = {
      id: "MiniMax-M2.5",
      name: "MiniMax-M2.5",
      family: "minimax",
      release_date: releaseDate,
      attachment: false,
      reasoning: true,
      tool_call: true,
      temperature: true,
      cost: {
        input: 0.3,
        output: 1.2,
        cache_read: 0.03,
        cache_write: 0.375,
      },
      limit,
      modalities,
      options: {},
    }

    const minimaxM25Free: Model = {
      id: "MiniMax-M2.5",
      name: "MiniMax-M2.5",
      family: "minimax",
      release_date: releaseDate,
      attachment: false,
      reasoning: true,
      tool_call: true,
      temperature: true,
      cost: {
        input: 0,
        output: 0,
        cache_read: 0,
        cache_write: 0,
      },
      limit,
      modalities,
      options: {},
    }

    const openrouterM25: Model = {
      id: "minimax/minimax-m2.5",
      name: "MiniMax M2.5",
      family: "minimax",
      release_date: releaseDate,
      attachment: false,
      reasoning: true,
      tool_call: true,
      temperature: true,
      interleaved: {
        field: "reasoning_details",
      },
      cost: {
        input: 0.3,
        output: 1.2,
      },
      limit,
      modalities,
      options: {},
    }

    ensureModel(database, "minimax", "MiniMax-M2.5", minimaxM25Paid)
    ensureModel(database, "minimax-cn", "MiniMax-M2.5", minimaxM25Paid)
    ensureModel(database, "minimax-coding-plan", "MiniMax-M2.5", minimaxM25Free)
    ensureModel(database, "minimax-cn-coding-plan", "MiniMax-M2.5", minimaxM25Free)
    ensureModel(database, "openrouter", "minimax/minimax-m2.5", openrouterM25)

    return database
  }

  export const Model = z.object({
    id: z.string(),
    name: z.string(),
    family: z.string().optional(),
    release_date: z.string(),
    attachment: z.boolean(),
    reasoning: z.boolean(),
    temperature: z.boolean(),
    tool_call: z.boolean(),
    interleaved: z
      .union([
        z.literal(true),
        z
          .object({
            field: z.enum(["reasoning_content", "reasoning_details"]),
          })
          .strict(),
      ])
      .optional(),
    cost: z
      .object({
        input: z.number(),
        output: z.number(),
        cache_read: z.number().optional(),
        cache_write: z.number().optional(),
        context_over_200k: z
          .object({
            input: z.number(),
            output: z.number(),
            cache_read: z.number().optional(),
            cache_write: z.number().optional(),
          })
          .optional(),
      })
      .optional(),
    limit: z.object({
      context: z.number(),
      input: z.number().optional(),
      output: z.number(),
    }),
    modalities: z
      .object({
        input: z.array(z.enum(["text", "audio", "image", "video", "pdf"])),
        output: z.array(z.enum(["text", "audio", "image", "video", "pdf"])),
      })
      .optional(),
    experimental: z.boolean().optional(),
    status: z.enum(["alpha", "beta", "deprecated"]).optional(),
    options: z.record(z.string(), z.any()),
    headers: z.record(z.string(), z.string()).optional(),
    provider: z.object({ npm: z.string(), api: z.string() }).optional(),
    variants: z.record(z.string(), z.record(z.string(), z.any())).optional(),
  })
  export type Model = z.infer<typeof Model>

  export const Provider = z.object({
    api: z.string().optional(),
    name: z.string(),
    env: z.array(z.string()),
    id: z.string(),
    npm: z.string().optional(),
    models: z.record(z.string(), Model),
  })

  export type Provider = z.infer<typeof Provider>

  export async function get() {
    if (!Flag.NIKCLI_DISABLE_MODELS_FETCH) {
      refresh()
    }
    const file = Bun.file(filepath)
    const result = await file.json().catch(() => {})
    if (result) return patch(result as Record<string, Provider>)
    if (typeof data === "function" && !Flag.NIKCLI_DISABLE_MODELS_FETCH) {
      try {
        const json = await data()
        return patch(JSON.parse(json) as Record<string, Provider>)
      } catch (error) {
        log.error("Failed to load embedded models data", { error })
      }
    }
    if (Flag.NIKCLI_DISABLE_MODELS_FETCH) return {}
    const url = Global.Path.modelsDevUrl
    const json = await fetch(`${url}/api.json`)
      .then((x) => x.text())
      .catch((error) => {
        log.error("Failed to fetch models.dev", { error })
        return "{}"
      })
    return patch(JSON.parse(json) as Record<string, Provider>)
  }

  export async function refresh() {
    if (Flag.NIKCLI_DISABLE_MODELS_FETCH) return
    const file = Bun.file(filepath)
    log.info("refreshing", {
      file,
    })
    const url = Global.Path.modelsDevUrl
    const result = await fetch(`${url}/api.json`, {
      headers: {
        "User-Agent": Installation.USER_AGENT,
      },
      signal: AbortSignal.timeout(10 * 1000),
    }).catch((e) => {
      log.error("Failed to fetch models.dev", {
        error: e,
      })
    })
    if (result && result.ok) await Bun.write(file, await result.text())
  }
}

setInterval(() => ModelsDev.refresh(), 60 * 1000 * 60).unref()
