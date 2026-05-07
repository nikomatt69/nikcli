import type { Argv } from "yargs"
import { Config } from "../../config/config"
import { cmd } from "./cmd"
import { UI } from "../ui"
import { Global } from "../../global"
import path from "path"
import { Instance } from "../../project/instance"
import { ttsRegistry } from "@/tool/speak/provider"
import { ELEVENLABS_VOICES_LIST, elevenLabsProvider } from "@/tool/speak/elevenlabs"
import { OPENROUTER_VOICES_LIST, openRouterProvider } from "@/tool/speak/openrouter"
import { runPromiseWithLayer, withCurrentInstance, withInstanceAsync } from "@/effect"
import { Effect } from "effect"

const DEFAULT_SPEAK_PROVIDER = "elevenlabs"
const DEFAULT_SPEAK_MODEL = "YOq2y2Up4RgXP2HyXjE5"
const DEFAULT_OPENROUTER_VOICE = "alloy"
const DEFAULT_OPENROUTER_MODEL_ID = "openai/gpt-audio-mini"
const OPENROUTER_VOICE_IDS = new Set(OPENROUTER_VOICES_LIST.map((voice) => voice.id))

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

// Register providers
ttsRegistry.register(elevenLabsProvider)
ttsRegistry.register(openRouterProvider)

interface TTSProviderInfo {
  id: string
  name: string
  description: string
  voices: { id: string; name: string }[]
}

// Pre-populate voices synchronously using known lists for CLI display
function getProviderVoices(providerId: string): { id: string; name: string }[] {
  if (providerId === "elevenlabs") {
    return ELEVENLABS_VOICES_LIST.map((voice) => ({ id: voice.id, name: voice.name }))
  }

  if (providerId === "openrouter") {
    return OPENROUTER_VOICES_LIST.map((voice) => ({ id: voice.id, name: voice.name }))
  }

  return []
}

async function getOpenRouterAudioModels(): Promise<{ id: string; name: string }[]> {
  try {
    return await openRouterProvider.getAudioModels({ refresh: true })
  } catch {
    return []
  }
}

export const SpeakModelCommand = cmd({
  command: "speak-model [provider] [model]",
  describe: "list or set TTS (speak) models",
  builder: (yargs: Argv) => {
    return yargs
      .positional("provider", {
        describe: "TTS provider ID (e.g., elevenlabs, openrouter)",
        type: "string",
      })
      .positional("model", {
        describe: "TTS model/voice ID to use",
        type: "string",
      })
      .option("reset", {
        describe: "reset speak config to defaults",
        type: "boolean",
        default: false,
      })
      .option("global", {
        describe: "edit global config instead of project config",
        type: "boolean",
        default: false,
      })
  },
  handler: async (args) => {
    await withInstanceAsync({ directory: process.cwd() }, async () => {
      {
        const config = await configGet()

        if (args.reset) {
          delete config.speak
          await saveConfig(config, args.global)
          UI.println(UI.Style.TEXT_SUCCESS_BOLD + "Speak config reset to defaults" + UI.Style.TEXT_NORMAL)
          return
        }

        if (args.model || args.provider) {
          const currentSpeak = config.speak ?? {}
          const provider = args.provider ?? currentSpeak.provider ?? DEFAULT_SPEAK_PROVIDER
          const providerChanged = provider !== (currentSpeak.provider ?? DEFAULT_SPEAK_PROVIDER)

          const nextSpeak: NonNullable<Config.Info["speak"]> = {
            ...currentSpeak,
            provider,
          }

          if (provider === "openrouter") {
            if (args.model) nextSpeak.modelId = args.model
            if (!nextSpeak.modelId) nextSpeak.modelId = DEFAULT_OPENROUTER_MODEL_ID
            if (providerChanged && !args.model) {
              nextSpeak.model = DEFAULT_OPENROUTER_VOICE
            }
            if (!nextSpeak.model || !OPENROUTER_VOICE_IDS.has(nextSpeak.model)) {
              nextSpeak.model = DEFAULT_OPENROUTER_VOICE
            }
          } else {
            if (args.model) nextSpeak.model = args.model
            if (providerChanged && !args.model) {
              nextSpeak.model = DEFAULT_SPEAK_MODEL
            }
            if (!nextSpeak.model) nextSpeak.model = DEFAULT_SPEAK_MODEL
            delete nextSpeak.modelId
          }

          config.speak = nextSpeak
          await saveConfig(config, args.global)
          UI.println(UI.Style.TEXT_SUCCESS_BOLD + "Speak config updated" + UI.Style.TEXT_NORMAL)
          UI.println(`  provider: ${config.speak.provider ?? `(default: ${DEFAULT_SPEAK_PROVIDER})`}`)
          UI.println(`  voice: ${config.speak.model ?? `(default: ${DEFAULT_SPEAK_MODEL})`}`)
          if (config.speak.provider === "openrouter") {
            UI.println(`  modelId: ${config.speak.modelId ?? `(default: ${DEFAULT_OPENROUTER_MODEL_ID})`}`)
          }
          return
        }

        const current = config.speak
        const openRouterAudioModels = await getOpenRouterAudioModels()

        UI.println("Current speak config:")
        UI.println(`  provider: ${current?.provider ?? `(default: ${DEFAULT_SPEAK_PROVIDER})`}`)
        UI.println(`  voice: ${current?.model ?? `(default: ${DEFAULT_SPEAK_MODEL})`}`)
        if ((current?.provider ?? DEFAULT_SPEAK_PROVIDER) === "openrouter") {
          UI.println(`  modelId: ${current?.modelId ?? `(default: ${DEFAULT_OPENROUTER_MODEL_ID})`}`)
        }
        UI.println("")

        UI.println("Available TTS providers:")
        UI.println("")

        // List all providers
        for (const provider of ttsRegistry.list()) {
          const isCurrent = current?.provider === provider.id
          const prefix = isCurrent ? "* " : "  "
          const voices = getProviderVoices(provider.id)
          UI.println(`${prefix}${provider.id} - ${provider.description}`)

          if (voices && voices.length > 0) {
            for (const voice of voices) {
              const isCurrentVoice = current?.provider === provider.id && current?.model === voice.id
              const voicePrefix = isCurrentVoice ? "  * " : "    "
              UI.println(`${voicePrefix}${voice.id} (${voice.name})`)
            }
          }

          if (provider.id === "openrouter") {
            if (openRouterAudioModels.length > 0) {
              UI.println("    models:")
              for (const model of openRouterAudioModels) {
                const isCurrentModel = current?.provider === "openrouter" && current?.modelId === model.id
                const modelPrefix = isCurrentModel ? "    * " : "      "
                UI.println(`${modelPrefix}${model.id} (${model.name})`)
              }
            } else {
              UI.println("    models: unavailable (check network)")
            }
          }
        }
      }
    })
  },
})

async function saveConfig(config: Config.Info, globalFlag: boolean) {
  const configPath = globalFlag ? path.join(Global.Path.config, "nikcli.json") : path.join(process.cwd(), "nikcli.json")

  const current = await Bun.file(configPath)
    .text()
    .catch(() => "{}")
  const parsed = JSON.parse(current || "{}")

  parsed.speak = config.speak

  await Bun.write(configPath, JSON.stringify(parsed, null, 2))
}

// Export for use by TUI dialog
export function getTTSProviderInfo(providerId: string): TTSProviderInfo | undefined {
  const provider = ttsRegistry.get(providerId)
  if (!provider) return undefined

  return {
    id: provider.id,
    name: provider.name,
    description: provider.description,
    voices: getProviderVoices(providerId),
  }
}

export function getAllProviderIds(): string[] {
  return ttsRegistry.list().map((p) => p.id)
}
