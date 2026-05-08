import type { Model } from "@nikcli-ai/sdk/v2"
import { Schema } from "effect"
import { zodObject } from "@/util/effect-zod"

export namespace CopilotModels {
  const ModelSchema = Schema.Struct({
    model_picker_enabled: Schema.Boolean,
    id: Schema.String,
    name: Schema.String,
    // every version looks like: `{model.id}-YYYY-MM-DD`
    version: Schema.String,
    supported_endpoints: Schema.optional(Schema.Array(Schema.String)),
    capabilities: Schema.Struct({
      family: Schema.String,
      limits: Schema.Struct({
        max_context_window_tokens: Schema.Number,
        max_output_tokens: Schema.Number,
        max_prompt_tokens: Schema.Number,
        vision: Schema.optional(
          Schema.Struct({
            max_prompt_image_size: Schema.Number,
            max_prompt_images: Schema.Number,
            supported_media_types: Schema.Array(Schema.String),
          }),
        ),
      }),
      supports: Schema.Struct({
        adaptive_thinking: Schema.optional(Schema.Boolean),
        max_thinking_budget: Schema.optional(Schema.Number),
        min_thinking_budget: Schema.optional(Schema.Number),
        reasoning_effort: Schema.optional(Schema.Array(Schema.String)),
        streaming: Schema.Boolean,
        structured_outputs: Schema.optional(Schema.Boolean),
        tool_calls: Schema.Boolean,
        vision: Schema.optional(Schema.Boolean),
      }),
    }),
  })
  const ResponseSchema = Schema.Struct({
    data: Schema.Array(ModelSchema),
  }).annotations({ identifier: "CopilotModelsResponse" })
  export const schema = zodObject(ResponseSchema)

  type Item = Schema.Schema.Type<typeof ModelSchema>

  function build(key: string, remote: Item, url: string, prev?: Model): Model {
    const reasoning =
      !!remote.capabilities.supports.adaptive_thinking ||
      !!remote.capabilities.supports.reasoning_effort?.length ||
      remote.capabilities.supports.max_thinking_budget !== undefined ||
      remote.capabilities.supports.min_thinking_budget !== undefined
    const image =
      (remote.capabilities.supports.vision ?? false) ||
      (remote.capabilities.limits.vision?.supported_media_types ?? []).some((item) => item.startsWith("image/"))

    return {
      id: key,
      providerID: "github-copilot",
      api: {
        id: remote.id,
        url,
        npm: "@ai-sdk/github-copilot",
      },
      // API response wins
      status: "active",
      limit: {
        context: remote.capabilities.limits.max_context_window_tokens,
        input: remote.capabilities.limits.max_prompt_tokens,
        output: remote.capabilities.limits.max_output_tokens,
      },
      capabilities: {
        temperature: prev?.capabilities.temperature ?? true,
        reasoning: prev?.capabilities.reasoning ?? reasoning,
        attachment: prev?.capabilities.attachment ?? true,
        toolcall: remote.capabilities.supports.tool_calls,
        input: {
          text: true,
          audio: false,
          image,
          video: false,
          pdf: false,
        },
        output: {
          text: true,
          audio: false,
          image: false,
          video: false,
          pdf: false,
        },
        interleaved: false,
      },
      // existing wins
      family: prev?.family ?? remote.capabilities.family,
      name: prev?.name ?? remote.name,
      cost: {
        input: 0,
        output: 0,
        cache: { read: 0, write: 0 },
      },
      options: prev?.options ?? {},
      headers: prev?.headers ?? {},
      release_date:
        prev?.release_date ??
        (remote.version.startsWith(`${remote.id}-`) ? remote.version.slice(remote.id.length + 1) : remote.version),
      variants: prev?.variants ?? {},
    }
  }

  export async function get(
    baseURL: string,
    headers: HeadersInit = {},
    existing: Record<string, Model> = {},
  ): Promise<Record<string, Model>> {
    const data = await fetch(`${baseURL}/models`, {
      headers,
    }).then(async (res) => {
      if (!res.ok) {
        throw new Error(`Failed to fetch models: ${res.status}`)
      }
      return schema.parse(await res.json())
    })

    const result = { ...existing }
    const remote = new Map(data.data.filter((m) => m.model_picker_enabled).map((m) => [m.id, m] as const))

    // prune existing models whose api.id isn't in the endpoint response
    for (const [key, model] of Object.entries(result)) {
      const m = remote.get(model.api.id)
      if (!m) {
        delete result[key]
        continue
      }
      result[key] = build(key, m, baseURL, model)
    }

    // add new endpoint models not already keyed in result
    for (const [id, m] of remote) {
      if (id in result) continue
      result[id] = build(id, m, baseURL)
    }

    return result
  }
}
