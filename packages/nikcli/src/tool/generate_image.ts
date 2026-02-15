import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./generate_image.txt"
import { Config } from "@/config/config"
import { Provider } from "@/provider/provider"
import { ProviderTransform } from "@/provider/transform"
import { experimental_generateImage } from "ai"
import { Identifier } from "@/id/id"
import type { MessageV2 } from "@/session/message-v2"
import { Installation } from "@/installation"
import os from "os"
import { Instance } from "@/project/instance"
import { Flag } from "@/flag/flag"

const GPT_IMAGE_LATEST = {
  provider: "openrouter",
  model: "openai/gpt-5-image",
} as const

const NANOBANANA_LATEST = {
  provider: "openrouter",
  model: "google/nano-banana-pro-2.5",
} as const

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
    generator: z.enum(["gpt_image", "nanobanana"]).optional().describe("Preset image generator to use (optional)"),
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
    const config = await Config.get()

    const preset = params.generator === "nanobanana" ? NANOBANANA_LATEST : GPT_IMAGE_LATEST
    const configured = params.generator ? undefined : config.image

    const providerID =
      params.provider ?? (params.generator ? preset.provider : configured?.provider) ?? GPT_IMAGE_LATEST.provider
    const modelID = params.model ?? (params.generator ? preset.model : configured?.model) ?? GPT_IMAGE_LATEST.model

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

    const model = await Provider.getModel(providerID, modelID)
    const imageModel = await Provider.getImageModel(model)

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
      headers: buildRequestHeaders({ model, sessionID: ctx.sessionID, messageID: ctx.messageID }),
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
        count: result.images.length,
        warnings,
      },
    }
  },
})
