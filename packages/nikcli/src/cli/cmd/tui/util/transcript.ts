import type { AssistantMessage, Part, UserMessage } from "@nikcli-ai/sdk/v2"
import { Locale } from "@/util/locale"

export type TranscriptOptions = {
  thinking: boolean
  toolDetails: boolean
  assistantMetadata: boolean
}

export type SessionInfo = {
  id: string
  title: string
  time: {
    created: number
    updated: number
  }
}

export type MessageWithParts = {
  info: UserMessage | AssistantMessage
  parts: Part[]
}

export function formatTranscript(
  session: SessionInfo,
  messages: MessageWithParts[],
  options: TranscriptOptions,
): string {
  let transcript = `# ${session.title}\n\n`
  transcript += `**Session ID:** ${session.id}\n`
  transcript += `**Created:** ${new Date(session.time.created).toLocaleString()}\n`
  transcript += `**Updated:** ${new Date(session.time.updated).toLocaleString()}\n\n`
  transcript += `---\n\n`

  for (const msg of messages) {
    transcript += formatMessage(msg.info, msg.parts, options)
    transcript += `---\n\n`
  }

  return transcript
}

/**
 * Structured counterpart to `formatTranscript`, for feeding a session to
 * something other than a human — a diffing script, an eval harness, another
 * model. The export dialog already advertised `.json` as a filename it accepts;
 * until now every extension produced markdown regardless.
 *
 * The same options apply, and for the same reason: a transcript exported
 * without tool output must not leak that output back through a second format.
 */
export function formatTranscriptJson(
  session: SessionInfo,
  messages: MessageWithParts[],
  options: TranscriptOptions,
): string {
  return (
    JSON.stringify(
      {
        session,
        messages: messages.map((msg) => ({
          info: options.assistantMetadata || msg.info.role !== "assistant" ? msg.info : stripMetadata(msg.info),
          parts: msg.parts.flatMap((part) => filterPart(part, options)),
        })),
      },
      null,
      2,
    ) + "\n"
  )
}

/** Drop the per-message provenance the markdown header would have omitted. */
function stripMetadata(msg: AssistantMessage) {
  const {
    agent: _agent,
    modelID: _modelID,
    providerID: _providerID,
    ...rest
  } = msg as AssistantMessage & Record<string, unknown>
  return rest
}

/**
 * Apply the transcript options to a part. Tool calls survive `toolDetails:
 * false` as a bare record of the call — knowing a tool ran is not the same as
 * dumping what it read, and the markdown path draws the line in the same place.
 */
function filterPart(part: Part, options: TranscriptOptions): unknown[] {
  if (part.type === "text" && part.synthetic) return []
  if (part.type === "reasoning" && !options.thinking) return []
  if (part.type === "tool" && !options.toolDetails) {
    return [{ type: part.type, tool: part.tool, state: { status: part.state.status } }]
  }
  return [part]
}

export function formatMessage(msg: UserMessage | AssistantMessage, parts: Part[], options: TranscriptOptions): string {
  let result = ""

  if (msg.role === "user") {
    result += `## User\n\n`
  } else {
    result += formatAssistantHeader(msg, options.assistantMetadata)
  }

  for (const part of parts) {
    result += formatPart(part, options)
  }

  return result
}

export function formatAssistantHeader(msg: AssistantMessage, includeMetadata: boolean): string {
  if (!includeMetadata) {
    return `## Assistant\n\n`
  }

  const duration =
    msg.time.completed && msg.time.created ? ((msg.time.completed - msg.time.created) / 1000).toFixed(1) + "s" : ""

  return `## Assistant (${Locale.titlecase(msg.agent)} · ${msg.modelID}${duration ? ` · ${duration}` : ""})\n\n`
}

export function formatPart(part: Part, options: TranscriptOptions): string {
  if (part.type === "text" && !part.synthetic) {
    return `${part.text}\n\n`
  }

  if (part.type === "reasoning") {
    if (options.thinking) {
      return `_Thinking:_\n\n${part.text}\n\n`
    }
    return ""
  }

  if (part.type === "tool") {
    let result = `\`\`\`\nTool: ${part.tool}\n`
    if (options.toolDetails && part.state.input) {
      result += `\n**Input:**\n\`\`\`json\n${JSON.stringify(part.state.input, null, 2)}\n\`\`\``
    }
    if (options.toolDetails && part.state.status === "completed" && part.state.output) {
      result += `\n**Output:**\n\`\`\`\n${part.state.output}\n\`\`\``
    }
    if (options.toolDetails && part.state.status === "error" && part.state.error) {
      result += `\n**Error:**\n\`\`\`\n${part.state.error}\n\`\`\``
    }
    result += `\n\`\`\`\n\n`
    return result
  }

  return ""
}
