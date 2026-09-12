import { Option } from "effect"
import { Runtime } from "../framework/runtime"
import { passthrough } from "../framework/args"
import { Commands } from "../commands"
import { Config } from "@/config/config"
import { UI } from "@/cli/ui"
import { Global } from "@nikcli-ai/util/global"
import path from "path"
import { Provider } from "@/provider/provider"
import { ModelsDev } from "@/provider/models"
import { runPromiseWithLayer, withCurrentInstance, withInstanceAsync } from "@/effect"
import { Effect } from "effect"

export const DEFAULT_IMAGE_PROVIDER = "openai"
export const DEFAULT_IMAGE_MODEL = "gpt-image-1"

export function configGet() {
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

export function providerList() {
  return runPromiseWithLayer(
    Provider.defaultLayer,
    withCurrentInstance(
      Effect.gen(function* () {
        const provider = yield* Provider.Service
        return yield* provider.list()
      }),
    ),
  )
}


export async function saveConfig(config: Config.Info, globalFlag: boolean) {
  const configPath = globalFlag ? path.join(Global.Path.config, "nikcli.json") : path.join(process.cwd(), "nikcli.json")

  const current = await Bun.file(configPath)
    .text()
    .catch(() => "{}")
  const parsed = JSON.parse(current || "{}")

  parsed.image = config.image

  await Bun.write(configPath, JSON.stringify(parsed, null, 2))
}

export default Runtime.handler(Commands.commands["image-model"], async (input) => {
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    "provider": Option.getOrUndefined(input["provider"]),
    "model": Option.getOrUndefined(input["model"]),
    "reset": input["reset"],
    "global": input["global"],
    "refresh": input["refresh"],
  }
  await withInstanceAsync({ directory: process.cwd() }, async () => {
    {
      if (args.refresh) {
        await ModelsDev.refresh()
        UI.println(UI.Style.TEXT_SUCCESS_BOLD + "Models cache refreshed" + UI.Style.TEXT_NORMAL)
      }

      const config = await configGet()

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

      const providers = await providerList()
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
    }
  })
})
