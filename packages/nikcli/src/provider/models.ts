import { Global } from "../global"
import { Log } from "../util/log"
import path from "path"
import { data } from "./models-macro" with { type: "macro" }
import { Installation } from "../installation"
import { Flag } from "../flag/flag"
import { cursorModelsDevProvider } from "../plugin/cursor"
import { type DeepMutable, zodObject } from "@/util/effect-zod"
import { Schema } from "effect"

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

    // MiniMax M3 (1M context, MiniMax Sparse Attention, multimodal input, real coding-plan pricing)
    const m3ReleaseDate = "2026-05-31"
    const m3Limit = {
      context: 1_048_576,
      output: 131_072,
    }
    const m3Modalities: NonNullable<Model["modalities"]> = {
      input: ["text", "image", "video"],
      output: ["text"],
    }

    const minimaxM3: Model = {
      id: "MiniMax-M3",
      name: "MiniMax-M3",
      family: "minimax",
      release_date: m3ReleaseDate,
      attachment: true,
      reasoning: true,
      tool_call: true,
      temperature: true,
      cost: {
        input: 0.3,
        output: 1.2,
        cache_read: 0.03,
        cache_write: 0.375,
      },
      limit: m3Limit,
      modalities: m3Modalities,
      options: {},
    }

    const openrouterM3: Model = {
      id: "minimax/minimax-m3",
      name: "MiniMax M3",
      family: "minimax",
      release_date: m3ReleaseDate,
      attachment: true,
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
      limit: m3Limit,
      modalities: m3Modalities,
      options: {},
    }

    ensureModel(database, "minimax", "MiniMax-M2.5", minimaxM25Paid)
    ensureModel(database, "minimax-cn", "MiniMax-M2.5", minimaxM25Paid)
    ensureModel(database, "minimax-coding-plan", "MiniMax-M2.5", minimaxM25Free)
    ensureModel(database, "minimax-cn-coding-plan", "MiniMax-M2.5", minimaxM25Free)
    ensureModel(database, "openrouter", "minimax/minimax-m2.5", openrouterM25)

    ensureModel(database, "minimax", "MiniMax-M3", minimaxM3)
    ensureModel(database, "minimax-cn", "MiniMax-M3", minimaxM3)
    ensureModel(database, "minimax-coding-plan", "MiniMax-M3", minimaxM3)
    ensureModel(database, "minimax-cn-coding-plan", "MiniMax-M3", minimaxM3)
    ensureModel(database, "openrouter", "minimax/minimax-m3", openrouterM3)

    // Cursor is not in models.dev; inject it so /connect dialog can offer it.
    if (!database["cursor"]) {
      database["cursor"] = cursorModelsDevProvider() as Provider
    }

    return database
  }

  const ModalityValueSchema = Schema.Literals(["text", "audio", "image", "video", "pdf"])

  const CostBlockSchema = Schema.Struct({
    input: Schema.Number,
    output: Schema.Number,
    cache_read: Schema.optional(Schema.Number),
    cache_write: Schema.optional(Schema.Number),
  })

  const ModelSchema = Schema.Struct({
    id: Schema.String,
    name: Schema.String,
    family: Schema.optional(Schema.String),
    release_date: Schema.String,
    attachment: Schema.Boolean,
    reasoning: Schema.Boolean,
    temperature: Schema.Boolean,
    tool_call: Schema.Boolean,
    interleaved: Schema.optional(
      Schema.Union([
        Schema.Literal(true),
        Schema.Struct({
          field: Schema.Literals(["reasoning_content", "reasoning_details"]),
        }),
      ]),
    ),
    cost: Schema.optional(
      Schema.Struct({
        input: Schema.Number,
        output: Schema.Number,
        cache_read: Schema.optional(Schema.Number),
        cache_write: Schema.optional(Schema.Number),
        context_over_200k: Schema.optional(CostBlockSchema),
      }),
    ),
    limit: Schema.Struct({
      context: Schema.Number,
      input: Schema.optional(Schema.Number),
      output: Schema.Number,
    }),
    modalities: Schema.optional(
      Schema.Struct({
        input: Schema.Array(ModalityValueSchema),
        output: Schema.Array(ModalityValueSchema),
      }),
    ),
    experimental: Schema.optional(Schema.Boolean),
    status: Schema.optional(Schema.Literals(["alpha", "beta", "deprecated"])),
    options: Schema.Record(Schema.String, Schema.Unknown),
    headers: Schema.optional(Schema.Record(Schema.String, Schema.String)),
    provider: Schema.optional(Schema.Struct({ npm: Schema.String, api: Schema.String })),
    variants: Schema.optional(Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.Unknown))),
  })
  export const Model = zodObject(ModelSchema)
  export type Model = DeepMutable<Schema.Schema.Type<typeof ModelSchema>>

  const ProviderSchema = Schema.Struct({
    api: Schema.optional(Schema.String),
    name: Schema.String,
    env: Schema.mutable(Schema.Array(Schema.String)),
    id: Schema.String,
    npm: Schema.optional(Schema.String),
    models: Schema.Record(Schema.String, ModelSchema),
  })
  export const Provider = zodObject(ProviderSchema)
  export type Provider = DeepMutable<Schema.Schema.Type<typeof ProviderSchema>>

  export async function get() {
    if (!Flag.NIKCLI_DISABLE_MODELS_FETCH) {
      refresh().catch((error) => {
        log.error("background models refresh failed", { error })
      })
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
      .then((x) => (x.ok ? x.text() : "{}"))
      .catch((error) => {
        log.error("Failed to fetch models.dev", { error })
        return "{}"
      })
    try {
      return patch(JSON.parse(json) as Record<string, Provider>)
    } catch (error) {
      // Captive portals / proxies can return a 200 with a non-JSON body.
      log.error("models.dev returned invalid JSON", { error })
      return {}
    }
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

setInterval(
  () => {
    ModelsDev.refresh().catch((error) => {
      Log.Default.error("scheduled models.dev refresh failed", { error })
    })
  },
  60 * 1000 * 60,
).unref()
