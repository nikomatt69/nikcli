import type { Plugin } from "@nikcli-ai/plugin"

/**
 * Dynamic Context Pruning
 *
 * Reduces token consumption by truncating long tool outputs in older messages.
 * The most recent `keepRecent` messages are never touched.
 * Tool result parts older than that are truncated to `maxOutputLength` characters.
 *
 * Options:
 *   keepRecent      — number of recent messages to leave untouched (default: 10)
 *   maxOutputLength — max chars for a single tool output before pruning (default: 2000)
 *   pruneThreshold  — minimum total message count before pruning activates (default: 20)
 */
export const DynamicContextPruningPlugin: Plugin = async (_input, options) => {
  const keepRecent = (options?.keepRecent as number | undefined) ?? 10
  const maxOutputLength = (options?.maxOutputLength as number | undefined) ?? 2000
  const pruneThreshold = (options?.pruneThreshold as number | undefined) ?? 20

  return {
    "experimental.chat.messages.transform": async (_input, output) => {
      const { messages } = output
      if (messages.length < pruneThreshold) return

      const cutoffIndex = Math.max(0, messages.length - keepRecent)

      for (let i = 0; i < cutoffIndex; i++) {
        const msg = messages[i]
        for (const part of msg.parts) {
          const p = part as Record<string, any>

          if (p.type === "tool") {
            const state = p.state as Record<string, any> | undefined
            if (!state) continue

            // Prune completed tool state output
            if (state.status === "completed" && typeof state.output === "string") {
              if (state.output.length > maxOutputLength) {
                const pruned = state.output.length - maxOutputLength
                state.output =
                  state.output.slice(0, maxOutputLength) + `\n[...${pruned} chars pruned by dynamic-context-pruning]`
              }
            }

            // Prune error messages
            if (state.status === "error" && typeof state.error === "string") {
              if (state.error.length > maxOutputLength) {
                const pruned = state.error.length - maxOutputLength
                state.error = state.error.slice(0, maxOutputLength) + `\n[...${pruned} chars pruned]`
              }
            }
          }

          if (p.type === "text" && typeof p.text === "string") {
            if (p.text.length > maxOutputLength * 2) {
              const pruned = p.text.length - maxOutputLength * 2
              p.text =
                p.text.slice(0, maxOutputLength * 2) + `\n[...${pruned} chars pruned by dynamic-context-pruning]`
            }
          }
        }
      }
    },
  }
}

export default { server: DynamicContextPruningPlugin }
