import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./generate_image.txt"
import { Config } from "@/config/config"
import { Provider } from "@/provider/provider"
import { ProviderTransform } from "@/provider/transform"
import { experimental_generateImage } from "ai"
import { Identifier } from "@nikcli-ai/util/id"
import type { MessageV2 } from "@/session/message-v2"
import { Installation } from "@/installation"
import os from "os"
import { Instance } from "@/project/instance"
import { Flag } from "@nikcli-ai/util/flag"
import { Effect } from "effect"
import { runPromiseWithLayer, withCurrentInstance } from "@/effect"

type Preset = {
  provider: string
  model: string
  description: string
}

/**
 * Curated image-generation presets. These are short, memorable aliases
 * for the (provider, model) pairs that are most useful out of the box.
 *
 * They route through models.dev (see `patch()` in src/provider/models.ts).
 * Any {provider, model} pair can still be passed directly via the
 * `provider` + `model` parameters — presets are convenience only.
 */
export const PRESETS = {
  // ---- OpenAI (direct, via @ai-sdk/openai) ----
  gpt_image: {
    provider: "openai",
    model: "gpt-image-1",
    description: "OpenAI gpt-image-1 (1024x1024/1024x1536/1536x1024, transparent)",
  },
  gpt_image_mini: {
    provider: "openai",
    model: "gpt-image-1-mini",
    description: "OpenAI gpt-image-1-mini (faster, cheaper than gpt-image-1)",
  },
  gpt_image_1_5: {
    provider: "openai",
    model: "gpt-image-1.5",
    description: "OpenAI gpt-image-1.5 (latest, highest quality)",
  },
  dall_e_3: {
    provider: "openai",
    model: "dall-e-3",
    description: "OpenAI dall-e-3 (1024x1024, 1024x1792, 1792x1024)",
  },

  // ---- Google (direct, via @ai-sdk/google) ----
  imagen_4: {
    provider: "google",
    model: "imagen-4.0-generate-001",
    description: "Google Imagen 4 (1K/2K, multiple aspect ratios)",
  },
  imagen_4_ultra: {
    provider: "google",
    model: "imagen-4.0-ultra-generate-001",
    description: "Google Imagen 4 Ultra (highest fidelity)",
  },
  imagen_4_fast: {
    provider: "google",
    model: "imagen-4.0-fast-generate-001",
    description: "Google Imagen 4 Fast (lowest latency)",
  },

  // ---- xAI (direct, via @ai-sdk/xai) ----
  grok_imagine: {
    provider: "xai",
    model: "grok-imagine-image",
    description: "xAI grok-imagine-image (1K, aspect-ratio only, supports editing)",
  },
  grok_imagine_pro: {
    provider: "xai",
    model: "grok-imagine-image-pro",
    description: "xAI grok-imagine-image-pro (1K/2K, quality/resolution options)",
  },

  // ---- OpenRouter (single key to many providers) ----
  nanobanana: {
    provider: "openrouter",
    model: "google/nano-banana-pro-2.5",
    description: "OpenRouter → Google Nano Banana Pro 2.5 (via /api/v1)",
  },
  nanobanana_openai: {
    provider: "openrouter",
    model: "openai/gpt-5-image",
    description: "OpenRouter → OpenAI GPT-5 Image (via /api/v1)",
  },

  // ---- Together AI (FLUX + SDXL) ----
  flux_dev: {
    provider: "togetherai",
    model: "black-forest-labs/FLUX.1-dev",
    description: "Together AI FLUX.1-dev (1024x1024, steps/guidance provider options)",
  },
  flux_schnell: {
    provider: "togetherai",
    model: "black-forest-labs/FLUX.1-schnell",
    description: "Together AI FLUX.1-schnell (4-step fast generation)",
  },
  flux_pro: {
    provider: "togetherai",
    model: "black-forest-labs/FLUX.1.1-pro",
    description: "Together AI FLUX.1.1-pro (production quality)",
  },
  sdxl: {
    provider: "togetherai",
    model: "stabilityai/stable-diffusion-xl-base-1.0",
    description: "Together AI Stable Diffusion XL base 1.0",
  },
} as const satisfies Record<string, Preset>

export type PresetName = keyof typeof PRESETS

function configGet() {
  return runPromiseWithLayer(
    Config.defaultLayer,
    withCurrentInstance(
      Effect.gen(function* () {
        const config = yield* Config.Service
        return yield* config.get()
      }),
    ),
  )
}

function runProvider<A, E>(effect: Effect.Effect<A, E, Provider.Service>) {
  return runPromiseWithLayer(Provider.defaultLayer, withCurrentInstance(effect))
}

function extFromMime(mime: string): string {
  switch (mime) {
    case "image/png":
      return ".png"
    case "image/jpeg":
      return ".jpg"
    case "image/webp":
      return ".webp"
    default:
      return ""
  }
}

function buildRequestHeaders(input: {
  model: Provider.Model
  sessionID: string
  messageID: string
}): Record<string, string> {
  if (input.model.providerID.startsWith("nikcli")) {
    return {
      "x-nikcli-project": Instance.project.id,
      "x-nikcli-session": input.sessionID,
      "x-nikcli-request": input.messageID,
      "x-nikcli-client": Flag.NIKCLI_CLIENT,
    }
  }

  return {
    "User-Agent": `nikcli/${Installation.VERSION} (${os.platform()} ${os.release()}; ${os.arch()})`,
  }
}

const parameters = z
  .object({
    prompt: z.string().describe("Text prompt for image generation"),
    generator: z
      .enum(Object.keys(PRESETS) as [PresetName, ...PresetName[]])
      .optional()
      .describe(
        `Preset image generator to use (optional). Available presets: ${Object.entries(PRESETS)
          .map(([k, v]) => `${k} (${v.provider}/${v.model})`)
          .join("; ")}. Ignored if \`provider\` + \`model\` are set.`,
      ),
    provider: z.string().optional().describe("Provider ID to use (overrides config/preset)"),
    model: z.string().optional().describe("Image model ID to use (overrides config/preset)"),
    n: z.number().int().min(1).max(4).optional().describe("Number of images to generate (default: 1)"),
    size: z
      .string()
      .regex(/^\d+x\d+$/, "size must be in the format {width}x{height}")
      .optional()
      .describe('Image size in the format "{width}x{height}" (optional)'),
    aspectRatio: z
      .string()
      .regex(/^\d+:\d+$/, "aspectRatio must be in the format {width}:{height}")
      .optional()
      .describe('Image aspect ratio in the format "{width}:{height}" (optional)'),
    seed: z.number().int().optional().describe("Deterministic seed (optional)"),
    providerOptions: z
      .record(z.string(), z.any())
      .optional()
      .describe("Provider-specific options passed through to the underlying image API (optional)"),
  })
  .superRefine((val, ctx) => {
    if (val.size && val.aspectRatio) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide either size or aspectRatio, not both.",
        path: ["aspectRatio"],
      })
    }
  })

export const GenerateImageTool = Tool.define("generate_image", {
  description: DESCRIPTION,
  parameters,
  async execute(params, ctx) {
    const config = await configGet()

    const preset: Preset | undefined = params.generator ? PRESETS[params.generator] : undefined
    const configured = params.generator ? undefined : config.image

    const fallbackProvider = preset?.provider ?? PRESETS.gpt_image.provider
    const fallbackModel = preset?.model ?? PRESETS.gpt_image.model

    const { provider: presetProvider, model: presetModel } = preset ?? {
      provider: fallbackProvider,
      model: fallbackModel,
    }
    const providerID = params.provider ?? (params.generator ? presetProvider : configured?.provider) ?? fallbackProvider
    const modelID = params.model ?? (params.generator ? presetModel : configured?.model) ?? fallbackModel

    await ctx.ask({
      permission: "generate_image",
      patterns: [`${providerID}/${modelID}`],
      always: ["*"],
      metadata: {
        provider: providerID,
        model: modelID,
        generator: params.generator,
        n: params.n,
        size: params.size,
        aspectRatio: params.aspectRatio,
        seed: params.seed,
      },
    })

    const { model, imageModel } = await runProvider(
      Effect.gen(function* () {
        const provider = yield* Provider.Service
        const model = yield* provider.getModel(providerID, modelID)
        const imageModel = yield* provider.getImageModel(model)
        return { model, imageModel }
      }),
    )

    const providerOptions = params.providerOptions
      ? ProviderTransform.providerOptions(model, params.providerOptions)
      : undefined

    const result = await experimental_generateImage({
      model: imageModel,
      prompt: params.prompt,
      n: params.n ?? 1,
      size: params.size as any,
      aspectRatio: params.aspectRatio as any,
      seed: params.seed,
      providerOptions,
      abortSignal: ctx.abort,
      headers: buildRequestHeaders({
        model,
        sessionID: ctx.sessionID,
        messageID: ctx.messageID,
      }),
    })

    const attachments: MessageV2.FilePart[] = result.images.map((image, index) => {
      const ext = extFromMime(image.mediaType)
      const filename = `generated-${index + 1}${ext}`
      return {
        id: Identifier.ascending("part"),
        sessionID: ctx.sessionID,
        messageID: ctx.messageID,
        type: "file",
        mime: image.mediaType,
        url: `data:${image.mediaType};base64,${image.base64}`,
        filename,
      }
    })

    const warnings = result.warnings?.length ? result.warnings : undefined

    const lines = [
      `Generated ${result.images.length} image(s) using ${providerID}/${modelID}.`,
      preset ? `Preset: ${params.generator} — ${preset.description}` : undefined,
      params.size ? `Size: ${params.size}` : undefined,
      params.aspectRatio ? `Aspect ratio: ${params.aspectRatio}` : undefined,
      params.seed !== undefined ? `Seed: ${params.seed}` : undefined,
      warnings ? `Warnings: ${warnings.map((w) => w.type).join(", ")}` : undefined,
    ].filter(Boolean)

    return {
      title: "Generate image",
      output: lines.join("\n"),
      attachments,
      metadata: {
        provider: providerID,
        model: modelID,
        generator: params.generator,
        preset: preset?.description,
        count: result.images.length,
        warnings,
      },
    }
  },
})
