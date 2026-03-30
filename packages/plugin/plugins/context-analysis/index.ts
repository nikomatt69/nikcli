import type { Plugin } from "@nikcli-ai/plugin"
import { tool } from "@nikcli-ai/plugin"

type Stats = {
  messageCount: number
  estimatedTokens: number
  toolCallCounts: Record<string, number>
  sessionStart: number
  lastUpdated: number
}

const stats: Stats = {
  messageCount: 0,
  estimatedTokens: 0,
  toolCallCounts: {},
  sessionStart: Date.now(),
  lastUpdated: Date.now(),
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

/**
 * Context Analysis
 *
 * Tracks message count, estimated token usage, and per-tool call counts
 * across the current session. Exposes a `context_stats` tool for inspection.
 *
 * Options:
 *   warnAt — emit a warning in tool output when estimated tokens exceed this (default: disabled)
 */
export const ContextAnalysisPlugin: Plugin = async (_input, options) => {
  const warnAt = options?.warnAt as number | undefined

  return {
    "experimental.chat.messages.transform": async (_input, output) => {
      const { messages } = output

      stats.messageCount = messages.length
      stats.lastUpdated = Date.now()

      let totalChars = 0
      const toolCounts: Record<string, number> = {}

      for (const msg of messages) {
        for (const part of msg.parts) {
          const p = part as Record<string, any>

          if (p.type === "text" && typeof p.text === "string") {
            totalChars += p.text.length
          }

          if (p.type === "tool") {
            const toolName = p.tool as string | undefined
            if (toolName) {
              toolCounts[toolName] = (toolCounts[toolName] ?? 0) + 1
            }
            const state = p.state as Record<string, any> | undefined
            if (state?.status === "completed" && typeof state.output === "string") {
              totalChars += state.output.length
            }
            if (state?.input) {
              totalChars += JSON.stringify(state.input).length
            }
          }

          if (p.type === "reasoning" && typeof p.text === "string") {
            totalChars += p.text.length
          }
        }
      }

      stats.estimatedTokens = estimateTokens(String(totalChars))
      stats.toolCallCounts = toolCounts
    },

    tool: {
      context_stats: tool({
        description: "Show current context usage statistics: message count, estimated tokens, and tool call breakdown.",
        args: {},
        async execute() {
          const elapsed = Math.floor((Date.now() - stats.sessionStart) / 1000)
          const topTools = Object.entries(stats.toolCallCounts)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 10)
            .map(([name, count]) => `  ${name}: ${count}`)

          const lines = [
            `Context Analysis`,
            `  Messages:         ${stats.messageCount}`,
            `  Estimated tokens: ~${stats.estimatedTokens.toLocaleString()}`,
            `  Session age:      ${elapsed}s`,
          ]

          if (topTools.length > 0) {
            lines.push(`  Top tool calls:`)
            lines.push(...topTools)
          }

          if (warnAt && stats.estimatedTokens > warnAt) {
            lines.push(``)
            lines.push(
              `  ⚠ Token estimate (${stats.estimatedTokens.toLocaleString()}) exceeds warning threshold (${warnAt.toLocaleString()})`,
            )
            lines.push(`  Consider using dynamic-context-pruning or starting a new session.`)
          }

          return lines.join("\n")
        },
      }),
    },
  }
}

export default { server: ContextAnalysisPlugin }
