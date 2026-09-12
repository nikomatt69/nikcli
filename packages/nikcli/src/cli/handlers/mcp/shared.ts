import { MCP } from "@/mcp"
import { McpAuth } from "@/mcp/auth"
import { Config } from "@/config/config"
import path from "path"
import { modify, applyEdits } from "jsonc-parser"
import { Effect } from "effect"
import { runPromiseWithLayer, withCurrentInstance } from "@/effect"

/** Helpers shared by the `mcp` commands. */

export function runMcpAuth<A, E>(effect: Effect.Effect<A, E, McpAuth.Service>) {
  return runPromiseWithLayer(McpAuth.defaultLayer, effect)
}

export function runMCP<A, E>(effect: Effect.Effect<A, E, MCP.Service>) {
  return runPromiseWithLayer(MCP.defaultLayer, withCurrentInstance(effect))
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

export function mcpStatus() {
  return runMCP(
    Effect.gen(function* () {
      const mcp = yield* MCP.Service
      return yield* mcp.status()
    }),
  )
}

export function mcpHasStoredTokens(name: string) {
  return runMCP(
    Effect.gen(function* () {
      const mcp = yield* MCP.Service
      return yield* mcp.hasStoredTokens(name)
    }),
  )
}

export function mcpGetAuthStatus(name: string) {
  return runMCP(
    Effect.gen(function* () {
      const mcp = yield* MCP.Service
      return yield* mcp.getAuthStatus(name)
    }),
  )
}

export function mcpAuthenticate(name: string) {
  return runMCP(
    Effect.gen(function* () {
      const mcp = yield* MCP.Service
      return yield* mcp.authenticate(name)
    }),
  )
}

export function mcpRemoveAuth(name: string) {
  return runMCP(
    Effect.gen(function* () {
      const mcp = yield* MCP.Service
      yield* mcp.removeAuth(name)
    }),
  )
}

export function getAuthStatusIcon(status: MCP.AuthStatus): string {
  switch (status) {
    case "authenticated":
      return "✓"
    case "expired":
      return "⚠"
    case "not_authenticated":
      return "✗"
  }
}

export function getAuthStatusText(status: MCP.AuthStatus): string {
  switch (status) {
    case "authenticated":
      return "authenticated"
    case "expired":
      return "expired"
    case "not_authenticated":
      return "not authenticated"
  }
}

export type McpEntry = NonNullable<Config.Info["mcp"]>[string]
export type McpConfigured = Config.Mcp

export function isMcpConfigured(config: McpEntry): config is McpConfigured {
  return typeof config === "object" && config !== null && "type" in config
}

export type McpRemote = Extract<McpConfigured, { type: "remote" }>
export function isMcpRemote(config: McpEntry): config is McpRemote {
  return isMcpConfigured(config) && config.type === "remote"
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

  return candidates[0]
}

export async function addMcpToConfig(name: string, mcpConfig: Config.Mcp, configPath: string) {
  const file = Bun.file(configPath)

  let text = "{}"
  if (await file.exists()) {
    text = await file.text()
  }

  const edits = modify(text, ["mcp", name], mcpConfig, {
    formattingOptions: { tabSize: 2, insertSpaces: true },
  })
  const result = applyEdits(text, edits)

  await Bun.write(configPath, result)

  return configPath
}
