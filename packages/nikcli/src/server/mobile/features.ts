import { Effect } from "effect"
import { Brain, getBrainConfig, getSessionsCountSince, readLastBrainAt } from "@/brain"
import { Config } from "@/config/config"
import { LSP } from "@/lsp"
import { FUSION_BUILTIN_VARIANTS, FUSION_MODEL_ID } from "@nikcli-ai/util/fusion"
import { runPromiseWithLayer, withCurrentInstance } from "@/effect"
import { configGet, runConfig } from "./helpers"

const HOUR_MS = 60 * 60 * 1000
const chatbot = () => import("@/chatbot").then((module) => module.ChatBot)

function configUpdate(patch: Config.Info) {
  return runConfig(
    Effect.gen(function* () {
      const config = yield* Config.Service
      yield* config.update(patch)
    }),
  )
}

async function configGetConnectors() {
  const config = await configGet()
  return config.connectors ?? {}
}

export async function brainStatus() {
  const cfg = await getBrainConfig()
  const lastBrainAt = await readLastBrainAt()
  const hoursSinceLastBrain = lastBrainAt ? (Date.now() - lastBrainAt) / HOUR_MS : Number.POSITIVE_INFINITY
  const sessionsSinceLastBrain = await getSessionsCountSince(lastBrainAt)
  const shouldTrigger = await Brain.shouldTrigger().catch(() => false)
  return {
    enabled: cfg.enabled,
    memoryEnabled: cfg.memoryEnabled,
    minHours: cfg.minHours,
    minSessions: cfg.minSessions,
    lastBrainAt,
    hoursSinceLastBrain: Number.isFinite(hoursSinceLastBrain) ? hoursSinceLastBrain : -1,
    sessionsSinceLastBrain,
    shouldTrigger,
    model: cfg.model,
  }
}

export function brainTrigger(input: { force?: boolean } | void) {
  return Brain.trigger({ force: input?.force })
}

export async function chatBotList() {
  const ChatBot = await chatbot()
  const running = ChatBot.getAllBots()
  const entries = []
  for (const [name, raw] of Object.entries(await configGetConnectors())) {
    if (typeof raw !== "object" || raw === null) continue
    const entry = raw as Config.Connector
    if (typeof entry.type !== "string" || !ChatBot.isChatPlatform(entry.type)) continue
    entries.push({
      name,
      type: entry.type,
      running: running.has(name),
      webhookPath: ChatBot.getWebhookPath(entry.type, name),
    })
  }
  return { bots: entries }
}

export async function chatBotStart(name: string) {
  const ChatBot = await chatbot()
  const raw = (await configGetConnectors())[name]
  if (typeof raw !== "object" || raw === null) {
    return { running: false, error: `No chat connector named ${name}` }
  }
  const entry = raw as Config.Connector
  if (typeof entry.type !== "string" || !ChatBot.isChatPlatform(entry.type)) {
    return { running: false, error: `No chat connector named ${name}` }
  }
  try {
    const { BotHandlers } = await import("@/chatbot/handlers")
    const bot = await BotHandlers.ensureAiBot(name, entry)
    if (!bot) {
      return {
        running: false,
        error: `Could not start ${name} — check credentials (nikcli bot auth)`,
      }
    }
    return { running: true }
  } catch (error) {
    return { running: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export async function chatBotStop(name: string) {
  const ChatBot = await chatbot()
  return { removed: ChatBot.removeBot(name) }
}

export async function observabilityGet() {
  const config = await configGet()
  return {
    enabled: config.experimental?.openTelemetry !== false,
    otlpEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? null,
  }
}

export async function observabilitySet(input: { enabled: boolean }) {
  await configUpdate({ experimental: { openTelemetry: input.enabled } })
  return { enabled: input.enabled, otlpEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? null }
}

export async function lspStatus() {
  try {
    const servers = await runPromiseWithLayer(
      LSP.defaultLayer,
      withCurrentInstance(
        Effect.gen(function* () {
          const lsp = yield* LSP.Service
          return yield* lsp.status()
        }),
      ),
    )
    return { servers }
  } catch (error) {
    return {
      servers: [],
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export async function fusionList() {
  const config = await configGet()
  const variants =
    (config.provider?.openrouter?.models?.[FUSION_MODEL_ID] as { variants?: Record<string, { disabled?: boolean }> })
      ?.variants ?? {}
  const names = new Set([...Object.keys(FUSION_BUILTIN_VARIANTS), ...Object.keys(variants)])
  const presets = [...names].map((name) => ({
    name,
    builtin: name in FUSION_BUILTIN_VARIANTS,
    enabled: variants[name]?.disabled !== true,
  }))
  return { presets }
}

export async function fusionSet(input: { name: string; enabled: boolean }) {
  const config = await configGet()
  const models = {
    ...config.provider?.openrouter?.models,
  }
  const current = (models[FUSION_MODEL_ID] ?? {}) as { variants?: Record<string, { disabled?: boolean }> }
  const variants = { ...current.variants }
  const base = variants[input.name] ?? FUSION_BUILTIN_VARIANTS[input.name] ?? {}
  variants[input.name] = { ...base, disabled: input.enabled ? undefined : true }
  models[FUSION_MODEL_ID] = { ...current, variants }
  await configUpdate({
    provider: {
      ...config.provider,
      openrouter: {
        ...config.provider?.openrouter,
        models,
      },
    },
  })
  return { name: input.name, enabled: input.enabled }
}
