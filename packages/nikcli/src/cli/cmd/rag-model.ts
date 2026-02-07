import type { Argv } from "yargs"
import { Config } from "../../config/config"
import { cmd } from "./cmd"
import { UI } from "../ui"
import { Global } from "../../global"
import path from "path"
import { Instance } from "../../project/instance"
import { Provider } from "../../provider/provider"
import { ModelsDev } from "../../provider/models"

export const OLLAMA_EMBED_MODELS = [
  "all-minilm",
  "nomic-embed-text",
  "mxbai-embed-large",
  "e5-small-v2",
  "snowflake-arctic-embed",
  "thenlper/gte-small",
  "BAAI/bge-small-en-v1.5",
] as const

export const LOCAL_EMBED_MODELS = [
  { provider: "openai", models: ["text-embedding-3-small", "text-embedding-3-large", "text-embedding-ada-002"] },
  { provider: "openrouter", models: ["nomic-embed-text", "snowflake-arctic-embed", "text-embedding-3-small"] },
  { provider: "google", models: ["text-embedding-004", "embedding-001", "multilingual-embedding-002"] },
  { provider: "cohere", models: ["embed-english-v3.0", "embed-english-light-v3.0", "embed-multilingual-v3.0"] },
  { provider: "vertexai", models: ["text-embedding-004", "embedding-001"] },
  { provider: "bedrock", models: ["amazon.titan-embed-text-v2:0", "amazon.titan-embed-g1-text-v1"] },
] as const

export const RagModelCommand = cmd({
  command: "rag-model [provider] [model]",
  describe: "list or set RAG embedding models",
  builder: (yargs: Argv) => {
    return yargs
      .positional("provider", {
        describe: "provider ID to filter embedding models by (e.g., ollama, openai, google)",
        type: "string",
      })
      .positional("model", {
        describe: "embedding model to set (e.g., nomic-embed-text for Ollama, text-embedding-3-small for OpenAI)",
        type: "string",
      })
      .option("reset", {
        describe: "reset RAG config to defaults",
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
          delete config.rag
          await saveConfig(config, args.global)
          UI.println(UI.Style.TEXT_SUCCESS_BOLD + "RAG config reset to defaults" + UI.Style.TEXT_NORMAL)
          return
        }

        if (args.model || args.provider) {
          config.rag = {
            model: args.model ?? config.rag?.model,
            provider: args.provider ?? config.rag?.provider,
          }
          await saveConfig(config, args.global)
          UI.println(UI.Style.TEXT_SUCCESS_BOLD + "RAG config updated" + UI.Style.TEXT_NORMAL)
          UI.println(`  model: ${config.rag.model}`)
          if (config.rag.provider) {
            UI.println(`  provider: ${config.rag.provider}`)
          }
          return
        }

        const providers = await Provider.list()
        const current = config.rag

        UI.println("Current RAG config:")
        UI.println(`  model: ${current?.model ?? "(default: nvidia/llama-embed-nemotron-8b)"}`)
        UI.println(`  provider: ${current?.provider ?? "(default: nvidia)"}`)
        UI.println("")

        const embedProviders = Object.entries(providers).filter(([, p]) =>
          Object.keys(p.models).some((m) => m.includes("embed") || m.includes("embedding")),
        )

        const hasCloudModels = embedProviders.length > 0
        const hasOllama = OLLAMA_EMBED_MODELS.length > 0
        const hasLocal = LOCAL_EMBED_MODELS.length > 0
        const hasAnyModels = hasCloudModels || hasOllama || hasLocal

        if (!hasAnyModels) {
          UI.println("No embedding models found in cache. Use --refresh to fetch from models.dev")
          return
        }

        UI.println("Available embedding models:")
        UI.println("")

        for (const [providerID, provider] of embedProviders.sort((a, b) => a[0].localeCompare(b[0]))) {
          const embedModels = Object.entries(provider.models)
            .filter(([m]) => m.includes("embed") || m.includes("embedding"))
            .sort(([a], [b]) => a.localeCompare(b))

          for (const [modelID, model] of embedModels) {
            const isCurrent = providerID === current?.provider && modelID === current?.model
            const prefix = isCurrent ? "* " : "  "
            UI.println(`${prefix}${providerID}/${modelID}`)
          }
        }

        for (const { provider, models } of LOCAL_EMBED_MODELS) {
          const alreadyShown = embedProviders.some(([p]) => p === provider)
          if (alreadyShown) continue

          UI.println(`  ${provider}`)
          for (const model of models) {
            const isCurrent = current?.provider === provider && current?.model === model
            const prefix = isCurrent ? "  * " : "    "
            UI.println(`${prefix}${model}`)
          }
        }

        if (hasOllama) {
          UI.println("  ollama")
          for (const model of OLLAMA_EMBED_MODELS) {
            const isCurrent = current?.provider === "ollama" && current?.model === model
            const prefix = isCurrent ? "  * " : "    "
            UI.println(`${prefix}${model}`)
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

  parsed.rag = config.rag

  await Bun.write(configPath, JSON.stringify(parsed, null, 2))
}
