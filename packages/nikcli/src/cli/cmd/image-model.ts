import type { Argv } from "yargs"
import { Config } from "../../config/config"
import { cmd } from "./cmd"
import { UI } from "../ui"
import { Global } from "../../global"
import path from "path"
import { Instance } from "../../project/instance"
import { Provider } from "../../provider/provider"
import { ModelsDev } from "../../provider/models"

const DEFAULT_IMAGE_PROVIDER = "poe"
const DEFAULT_IMAGE_MODEL = "openai/gpt-image-1.5"

export const ImageModelCommand = cmd({
  command: "image-model [provider] [model]",
  describe: "list or set image generation models",
  builder: (yargs: Argv) => {
    return yargs
      .positional("provider", {
        describe: "provider ID to use for image generation (e.g., poe, openai, vercel)",
        type: "string",
      })
      .positional("model", {
        describe: "image model ID to use (e.g., openai/gpt-image-1.5, google/nano-banana-pro)",
        type: "string",
      })
      .option("reset", {
        describe: "reset image config to defaults",
        type: "boolean",
        default: false,
      })
      .option("global", {
        describe: "edit global config instead of project config",
        type: "boolean",
        default: false,
      })
      .option("refresh", {
        describe: "refresh the models cache from models.dev",
        type: "boolean",
        default: false,
      })
  },
  handler: async (args) => {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        if (args.refresh) {
          await ModelsDev.refresh()
          UI.println(UI.Style.TEXT_SUCCESS_BOLD + "Models cache refreshed" + UI.Style.TEXT_NORMAL)
        }

        const configState = await Config.state()
        const config = configState.config

        if (args.reset) {
          delete config.image
          await saveConfig(config, args.global)
          UI.println(UI.Style.TEXT_SUCCESS_BOLD + "Image config reset to defaults" + UI.Style.TEXT_NORMAL)
          return
        }

        if (args.model || args.provider) {
          config.image = {
            model: args.model ?? config.image?.model,
            provider: args.provider ?? config.image?.provider,
          }
          await saveConfig(config, args.global)
          UI.println(UI.Style.TEXT_SUCCESS_BOLD + "Image config updated" + UI.Style.TEXT_NORMAL)
          UI.println(`  model: ${config.image.model ?? `(default: ${DEFAULT_IMAGE_MODEL})`}`)
          UI.println(`  provider: ${config.image.provider ?? `(default: ${DEFAULT_IMAGE_PROVIDER})`}`)
          return
        }

        const providers = await Provider.list()
        const current = config.image

        UI.println("Current image config:")
        UI.println(`  model: ${current?.model ?? `(default: ${DEFAULT_IMAGE_MODEL})`}`)
        UI.println(`  provider: ${current?.provider ?? `(default: ${DEFAULT_IMAGE_PROVIDER})`}`)
        UI.println("")

        const imageProviders = Object.entries(providers).filter(([, p]) =>
          Object.values(p.models).some((m) => m.capabilities.output.image),
        )

        if (imageProviders.length === 0) {
          UI.println("No image-capable models found in cache. Use --refresh to fetch from models.dev")
          return
        }

        UI.println("Available image models:")
        UI.println("")

        for (const [providerID, provider] of imageProviders.sort((a, b) => a[0].localeCompare(b[0]))) {
          const imageModels = Object.entries(provider.models)
            .filter(([modelID, model]) => {
              if (!model.capabilities.output.image) return false
              const lower = modelID.toLowerCase()
              if (lower.includes("dall")) return false
              return true
            })
            .sort(([a], [b]) => a.localeCompare(b))

          for (const [modelID] of imageModels) {
            const isCurrent = providerID === current?.provider && modelID === current?.model
            const prefix = isCurrent ? "* " : "  "
            UI.println(`${prefix}${providerID}/${modelID}`)
          }
        }
      },
    })
  },
})

async function saveConfig(config: Config.Info, globalFlag: boolean) {
  const configPath = globalFlag
    ? path.join(Global.Path.config, "nikcli.jsonc")
    : path.join(process.cwd(), "nikcli.jsonc")

  const current = await Bun.file(configPath)
    .text()
    .catch(() => "{}")
  const parsed = JSON.parse(current || "{}")

  parsed.image = config.image

  await Bun.write(configPath, JSON.stringify(parsed, null, 2))
}
