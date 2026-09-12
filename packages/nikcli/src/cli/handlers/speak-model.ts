import { Option } from "effect"
import { Runtime } from "../framework/runtime"
import { passthrough } from "../framework/args"
import { Commands } from "../commands"
import { Config } from "@/config/config"
import { UI } from "@/cli/ui"
import { Global } from "@nikcli-ai/util/global"
import path from "path"
import { ttsRegistry } from "@nikcli-ai/util/tts/provider"
import { ELEVENLABS_VOICES_LIST, elevenLabsProvider } from "@nikcli-ai/util/tts/elevenlabs"
import { OPENROUTER_VOICES_LIST } from "@nikcli-ai/util/tts/openrouter"
import { openRouterProvider } from "@/tool/speak/openrouter"
import { runPromiseWithLayer, withCurrentInstance, withInstanceAsync } from "@/effect"
import { Effect } from "effect"

export const DEFAULT_SPEAK_PROVIDER = "elevenlabs"
export const DEFAULT_SPEAK_MODEL = "YOq2y2Up4RgXP2HyXjE5"
export const DEFAULT_OPENROUTER_VOICE = "alloy"
export const DEFAULT_OPENROUTER_MODEL_ID = "openai/gpt-audio-mini"
export const OPENROUTER_VOICE_IDS = new Set(OPENROUTER_VOICES_LIST.map((voice) => voice.id))

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

// Register providers
ttsRegistry.register(elevenLabsProvider)
ttsRegistry.register(openRouterProvider)

export interface TTSProviderInfo {
  id: string
  name: string
  description: string
  voices: { id: string; name: string }[]
}

// Pre-populate voices synchronously using known lists for CLI display
export function getProviderVoices(providerId: string): { id: string; name: string }[] {
  if (providerId === "elevenlabs") {
    return ELEVENLABS_VOICES_LIST.map((voice) => ({ id: voice.id, name: voice.name }))
  }

  if (providerId === "openrouter") {
    return OPENROUTER_VOICES_LIST.map((voice) => ({ id: voice.id, name: voice.name }))
  }

  return []
}

export async function getOpenRouterAudioModels(): Promise<{ id: string; name: string }[]> {
  try {
    return await openRouterProvider.getAudioModels({ refresh: true })
  } catch {
    return []
  }
}


export async function saveConfig(config: Config.Info, globalFlag: boolean) {
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

export default Runtime.handler(Commands.commands["speak-model"], async (input) => {
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    "provider": Option.getOrUndefined(input["provider"]),
    "model": Option.getOrUndefined(input["model"]),
    "reset": input["reset"],
    "global": input["global"],
  }
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
})
