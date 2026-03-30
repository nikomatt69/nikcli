import type { Plugin } from "@nikcli-ai/plugin"
import { tool } from "@nikcli-ai/plugin"
import { writeFileSync, mkdirSync } from "fs"
import { join } from "path"

function isoTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, -5)
}

function extractTextFromParts(parts: any[]): string {
  return parts
    .filter((p) => p.type === "text" && typeof p.text === "string")
    .map((p) => p.text as string)
    .join("\n")
    .trim()
}

function extractToolCalls(messages: any[]): string[] {
  const calls: string[] = []
  for (const msg of messages) {
    for (const part of msg.parts ?? []) {
      if (part.type === "tool") {
        const toolName = part.tool as string | undefined
        const state = part.state as Record<string, any> | undefined
        if (toolName && state?.input) {
          const input = state.input as Record<string, any>
          const path = input.path ?? input.file_path ?? input.file ?? input.command
          if (path) calls.push(`${toolName}(${path})`)
        }
      }
    }
  }
  return [...new Set(calls)]
}

function buildHandoffDocument(messages: any[], context: string | undefined): string {
  if (messages.length === 0) return "No messages found in this session."

  const userMessages = messages.filter((m) => m.info?.role === "user")
  const assistantMessages = messages.filter((m) => m.info?.role === "assistant")

  const firstUserText = userMessages[0]
    ? extractTextFromParts(userMessages[0].parts ?? []).slice(0, 500)
    : "(no initial message)"

  const lastAssistantText = assistantMessages[assistantMessages.length - 1]
    ? extractTextFromParts((assistantMessages[assistantMessages.length - 1].parts ?? [])).slice(0, 800)
    : "(no assistant response yet)"

  const toolCalls = extractToolCalls(messages)

  const lines: string[] = [
    `# Session Handoff`,
    ``,
    `**Date:** ${new Date().toISOString()}`,
    `**Messages:** ${messages.length} (${userMessages.length} user, ${assistantMessages.length} assistant)`,
    ``,
    `## Original Task`,
    ``,
    firstUserText,
    ``,
    `## Current State`,
    ``,
    lastAssistantText,
    ``,
  ]

  if (toolCalls.length > 0) {
    lines.push(`## Files / Commands Touched`, ``)
    for (const call of toolCalls.slice(0, 30)) {
      lines.push(`- ${call}`)
    }
    lines.push(``)
  }

  if (context) {
    lines.push(`## Additional Context`, ``, context, ``)
  }

  lines.push(
    `## Next Steps`,
    ``,
    `Continue from the current state above. Review the files touched and pick up where the last assistant message left off.`,
    ``,
  )

  return lines.join("\n")
}

/**
 * Handoff
 *
 * Generates a structured markdown handoff document summarising the current
 * session so that work can be continued in a new session or by another agent.
 *
 * Options:
 *   autoSave — if true, save a handoff automatically when session ends (default: false)
 */
export const HandoffPlugin: Plugin = async (input, options) => {
  const { client, directory } = input
  const autoSave = (options?.autoSave as boolean | undefined) ?? false

  async function createHandoffDoc(sessionID: string, context?: string, outputPath?: string): Promise<string> {
    const { data: messages } = await client.session.messages({ path: { id: sessionID } })
    const doc = buildHandoffDocument(messages ?? [], context)

    const savePath =
      outputPath ?? join(directory, ".nikcli", "handoffs", `handoff-${isoTimestamp()}.md`)

    mkdirSync(savePath.replace(/\/[^/]+$/, ""), { recursive: true })
    writeFileSync(savePath, doc, "utf8")

    return savePath
  }

  return {
    event: async ({ event }) => {
      if (!autoSave) return
      if ((event as any).type === "session.idle" || (event as any).type === "session.error") {
        const sessionID = (event as any).properties?.sessionID as string | undefined
        if (!sessionID) return
        try {
          await createHandoffDoc(sessionID)
        } catch {}
      }
    },

    tool: {
      create_handoff: tool({
        description:
          "Generate a structured handoff document for the current session. Saves to .nikcli/handoffs/ and returns the file path.",
        args: {
          context: tool.schema
            .string()
            .optional()
            .describe("Additional notes or context to include in the handoff"),
          outputPath: tool.schema
            .string()
            .optional()
            .describe("Custom path to save the handoff file (defaults to .nikcli/handoffs/<timestamp>.md)"),
        },
        async execute(args, ctx) {
          const savePath = await createHandoffDoc(ctx.sessionID, args.context, args.outputPath)
          return `Handoff document saved to:\n${savePath}\n\nShare this file or its contents to continue work in a new session.`
        },
      }),
    },
  }
}

export default { server: HandoffPlugin }
