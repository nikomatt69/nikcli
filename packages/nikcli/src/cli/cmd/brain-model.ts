import type { Argv } from "yargs"
import { Config } from "../../config/config"
import { cmd } from "./cmd"
import { UI } from "../ui"
import { Global } from "@nikcli-ai/util/global"
import path from "path"
import { Provider } from "../../provider/provider"
import { ModelsDev } from "../../provider/models"
import { runPromiseWithLayer, withCurrentInstance, withInstanceAsync } from "@/effect"
import { Effect } from "effect"

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

function providerList() {
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

function parseBrainModel(value: string): { providerID: string; modelID: string } | undefined {
  const trimmed = value.trim()
  if (trimmed === "") return undefined
  const slash = trimmed.indexOf("/")
  if (slash <= 0 || slash === trimmed.length - 1) {
    throw new Error(`Invalid model "${value}". Expected format: provider/model (e.g. anthropic/claude-sonnet-4-5).`)
  }
  return {
    providerID: trimmed.slice(0, slash),
    modelID: trimmed.slice(slash + 1),
  }
}

export const BrainModelCommand = cmd({
  command: "brain-model [model]",
  describe: "list or set the model used by Brain memory consolidation",
  builder: (yargs: Argv) => {
    return yargs
      .positional("model", {
        describe: "model to use in the format of provider/model (e.g. anthropic/claude-sonnet-4-5)",
        type: "string",
      })
      .option("reset", {
        describe: "reset the brain model back to the default",
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
    await withInstanceAsync({ directory: process.cwd() }, async () => {
      if (args.refresh) {
        await ModelsDev.refresh()
        UI.println(UI.Style.TEXT_SUCCESS_BOLD + "Models cache refreshed" + UI.Style.TEXT_NORMAL)
      }

      const config = await configGet()
      const experimental = { ...config.experimental }

      if (args.reset) {
        delete experimental.brainModel
        await saveExperimental(experimental, args.global)
        UI.println(UI.Style.TEXT_SUCCESS_BOLD + "Brain model reset to default" + UI.Style.TEXT_NORMAL)
        return
      }

      if (args.model) {
        const parsed = parseBrainModel(args.model)
        if (!parsed) {
          throw new Error("Brain model cannot be empty")
        }
        experimental.brainModel = `${parsed.providerID}/${parsed.modelID}`
        await saveExperimental(experimental, args.global)
        UI.println(UI.Style.TEXT_SUCCESS_BOLD + "Brain model updated" + UI.Style.TEXT_NORMAL)
        UI.println(`  model: ${experimental.brainModel}`)
        return
      }

      const providers = await providerList()
      const current = experimental.brainModel

      UI.println("Current brain model:")
      UI.println(`  model: ${current ?? "(default)"}`)
      UI.println("")

      UI.println("Available models:")
      UI.println("")

      const sortedProviders = Object.entries(providers).sort((a, b) => a[0].localeCompare(b[0]))
      for (const [providerID, provider] of sortedProviders) {
        for (const modelID of Object.keys(provider.models).sort((a, b) => a.localeCompare(b))) {
          if (provider.models[modelID]?.status === "deprecated") continue
          const value = `${providerID}/${modelID}`
          const isCurrent = value === current
          const prefix = isCurrent ? "* " : "  "
          UI.println(`${prefix}${value}`)
        }
      }
    })
  },
})

async function saveExperimental(experimental: NonNullable<Config.Info["experimental"]>, globalFlag: boolean) {
  const configPath = globalFlag ? path.join(Global.Path.config, "nikcli.json") : path.join(process.cwd(), "nikcli.json")

  const current = await Bun.file(configPath)
    .text()
    .catch(() => "{}")
  const parsed = JSON.parse(current || "{}")

  if (Object.keys(experimental).length === 0) {
    delete parsed.experimental
  } else {
    parsed.experimental = experimental
  }

  await Bun.write(configPath, JSON.stringify(parsed, null, 2))
}
