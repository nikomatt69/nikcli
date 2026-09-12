import { ConnectorAuth } from "@/connectors/auth"
import { Config } from "@/config/config"
import { modify, applyEdits } from "jsonc-parser"
import path from "path"
import { Effect } from "effect"
import { runPromiseWithLayer, withCurrentInstance } from "@/effect"

/** Helpers shared by the `chatbot` commands. */

export type ConnectorConfigured = Config.Connector

export function connectorAuthUpdateBotToken(name: string, botToken: string) {
  return runPromiseWithLayer(
    ConnectorAuth.defaultLayer,
    Effect.gen(function* () {
      const auth = yield* ConnectorAuth.Service
      yield* auth.updateBotToken(name, botToken)
    }),
  )
}

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

export async function getChatBot() {
  const mod = await import("@/chatbot")
  return mod.ChatBot
}

export async function getBotHandlers() {
  const mod = await import("@/chatbot/handlers")
  return mod.BotHandlers
}

export function isChatPlatform(type: string): boolean {
  return ["discord", "slack", "teams", "gchat", "linear", "github"].includes(type)
}

export async function resolveConfigPath(baseDir: string, global = false) {
  const candidates = [path.join(baseDir, "nikcli.json")]

  if (!global) {
    candidates.push(path.join(baseDir, ".nikcli", "nikcli.json"))
  }

  for (const candidate of candidates) {
    if (await Bun.file(candidate).exists()) {
      return candidate
    }
  }

  return path.join(baseDir, "nikcli.json")
}

export async function addConnectorToConfig(name: string, connectorConfig: Config.Connector, configPath: string) {
  const file = Bun.file(configPath)

  let text = "{}"
  if (await file.exists()) {
    text = await file.text()
  }

  const edits = modify(text, ["connectors", name], connectorConfig, {
    formattingOptions: { tabSize: 2, insertSpaces: true },
  })
  const result = applyEdits(text, edits)

  await Bun.write(configPath, result)

  return configPath
}
