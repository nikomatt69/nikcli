import type { AgentSideConnection, Usage } from "@agentclientprotocol/sdk"
import type { AssistantMessage, NikcliClient, SessionMessageResponse } from "@nikcli-ai/sdk/httpapi"
import { Log } from "@nikcli-ai/util/log"

/**
 * Token usage tracking for the ACP `usage_update` notification.
 *
 * The ACP protocol exposes a `UsageUpdate` notification that lets the
 * agent report `used / size / cost` so the client can render a
 * context-window progress bar. The nikcli backend tracks per-message
 * tokens and cost on the `AssistantMessage`, so the service layer just
 * needs to:
 *
 * 1. Pull the latest assistant message for the session.
 * 2. Resolve the model's `limit.context` from the provider registry.
 * 3. Compute the total session cost from prior assistant messages.
 * 4. Emit the notification.
 *
 * Both steps are pure data shaping — the connection is shared with the
 * event subscription so the same lifecycle (start/stop with the SSE loop)
 * applies.
 */

const log = Log.create({ service: "acp-usage" })

export type AssistantTokenCost = Pick<AssistantMessage, "cost" | "tokens">

export type AssistantMessageInfo = AssistantTokenCost &
  Pick<AssistantMessage, "role"> &
  Partial<Pick<AssistantMessage, "providerID" | "modelID">>

export type SessionMessage = {
  readonly info: { readonly role: "user" | "assistant" } | AssistantMessageInfo
}

export type MessagesInput = {
  readonly sessionID: string
  readonly directory: string
}

export type UsageConnection = Pick<AgentSideConnection, "sessionUpdate">

export type ContextLimitInput = {
  readonly directory: string
  readonly providerID: string
  readonly modelID: string
}

export type ContextLimitLoader = (input: ContextLimitInput) => Promise<number | undefined>

/**
 * Build the ACP `Usage` block for an assistant message. Mirrors opencode's
 * helper so the same token accounting shows up in any client.
 */
export function buildUsage(message: AssistantTokenCost): Usage {
  const cachedReadTokens = message.tokens.cache.read
  const cachedWriteTokens = message.tokens.cache.write
  const thoughtTokens = message.tokens.reasoning

  return {
    inputTokens: message.tokens.input,
    outputTokens: message.tokens.output,
    totalTokens: message.tokens.input + message.tokens.output + thoughtTokens + cachedReadTokens + cachedWriteTokens,
    ...(thoughtTokens > 0 ? { thoughtTokens } : undefined),
    ...(cachedReadTokens > 0 ? { cachedReadTokens } : undefined),
    ...(cachedWriteTokens > 0 ? { cachedWriteTokens } : undefined),
  }
}

/**
 * Find the most recent assistant message in a session's message stream.
 * Returns `undefined` when there are no assistant messages yet (e.g. the
 * session was just created).
 */
export function latestAssistantMessage(messages: ReadonlyArray<SessionMessage>): AssistantMessageInfo | undefined {
  return messages
    .filter((message): message is { readonly info: AssistantMessageInfo } => message.info.role === "assistant")
    .at(-1)?.info
}

/**
 * Sum the `cost` field across every assistant message in the stream.
 * Returns 0 when there are no assistant messages yet so the wire payload
 * always carries a meaningful number.
 */
export function totalSessionCost(messages: ReadonlyArray<SessionMessage>): number {
  return messages
    .filter((message): message is { readonly info: AssistantMessageInfo } => message.info.role === "assistant")
    .reduce((sum, message) => sum + (message.info.cost ?? 0), 0)
}

/**
 * Send a `usage_update` notification for the latest assistant message.
 *
 * Resolves the model's context limit through the provided loader, falling
 * back to omitting the notification when the limit is unknown. Errors are
 * logged and swallowed — usage notifications are best-effort and must
 * never break the prompt turn.
 */
export async function sendUsageUpdate(input: {
  readonly connection: UsageConnection | undefined
  readonly sdk: NikcliClient
  readonly sessionID: string
  readonly directory: string
  readonly contextLimit: ContextLimitLoader
}): Promise<void> {
  if (!input.connection) return

  let messages: ReadonlyArray<SessionMessage>
  try {
    const response = await input.sdk.session.messages(
      { sessionID: input.sessionID, directory: input.directory },
      { throwOnError: true },
    )
    messages = (response.data ?? []) as ReadonlyArray<SessionMessage>
  } catch (error) {
    log.error("failed to fetch messages for usage update", {
      error,
      sessionID: input.sessionID,
    })
    return
  }

  const latest = latestAssistantMessage(messages)
  if (!latest?.providerID || !latest?.modelID) return

  const size = await input
    .contextLimit({
      directory: input.directory,
      providerID: latest.providerID,
      modelID: latest.modelID,
    })
    .catch((error: unknown) => {
      log.error("failed to resolve context limit", { error })
      return undefined
    })
  if (!size) return

  const used = (latest.tokens?.input ?? 0) + (latest.tokens?.cache?.read ?? 0)

  await input.connection
    .sessionUpdate({
      sessionId: input.sessionID,
      update: {
        sessionUpdate: "usage_update",
        used,
        size,
        cost: { amount: totalSessionCost(messages), currency: "USD" },
      },
    })
    .catch((error: unknown) => {
      log.error("failed to send usage_update", { error })
    })
}

export * as UsageService from "./usage"
