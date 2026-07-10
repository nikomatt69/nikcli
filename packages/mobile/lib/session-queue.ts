import type { MessageWithParts } from "@/lib/types"

/** Last in-flight assistant message — user messages after this are queued server-side. */
export function getPendingAssistantMessageId(messages: MessageWithParts[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.info.role !== "assistant") continue
    const completed = message.info.time.completed
    if (!completed) return message.info.id
  }
  return null
}

export function isQueuedUserMessage(message: MessageWithParts, pendingAssistantId: string | null) {
  if (!pendingAssistantId || message.info.role !== "user") return false
  return message.info.id > pendingAssistantId
}

export function countQueuedUserMessages(messages: MessageWithParts[], pendingAssistantId: string | null) {
  if (!pendingAssistantId) return 0
  return messages.filter((message) => isQueuedUserMessage(message, pendingAssistantId)).length
}

export function sessionIsProcessing(status?: { type: string }) {
  return status?.type === "busy" || status?.type === "retry"
}
