import type { Event as NikcliEvent, Message, MobileSessionDetail, Part } from "@nikcli-ai/sdk/v2/client"

export type MessageWithParts = MobileSessionDetail["messages"][number]

export function upsertMessage(messages: MessageWithParts[], next: Message) {
  const index = messages.findIndex((item) => item.info.id === next.id)
  if (index !== -1) {
    const updated = [...messages]
    updated[index] = { ...messages[index], info: next }
    return updated
  }

  return [...messages, { info: next, parts: [] }].sort(
    (left, right) => left.info.time.created - right.info.time.created,
  )
}

export function upsertPart(messages: MessageWithParts[], part: Part) {
  if (!("messageID" in part)) return messages

  const index = messages.findIndex((item) => item.info.id === part.messageID)
  if (index === -1) return messages

  const next = [...messages]
  const message = { ...next[index], parts: [...next[index].parts] }
  const partIndex = message.parts.findIndex((item) => item.id === part.id)

  if (partIndex === -1) message.parts.push(part)
  else message.parts[partIndex] = part

  next[index] = message
  return next
}

export function reduceSessionDetail(detail: MobileSessionDetail, event: NikcliEvent) {
  if (event.type === "message.updated") {
    return { ...detail, messages: upsertMessage(detail.messages, event.properties.info) }
  }

  if (event.type === "message.part.updated") {
    return { ...detail, messages: upsertPart(detail.messages, event.properties.part) }
  }

  if (event.type === "message.removed") {
    return {
      ...detail,
      messages: detail.messages.filter((item) => item.info.id !== event.properties.messageID),
    }
  }

  if (event.type === "message.part.removed") {
    return {
      ...detail,
      messages: detail.messages.map((item) =>
        item.info.id === event.properties.messageID
          ? { ...item, parts: item.parts.filter((part) => part.id !== event.properties.partID) }
          : item,
      ),
    }
  }

  if (event.type === "session.updated") {
    return { ...detail, info: event.properties.info }
  }

  if (event.type === "session.status") {
    return { ...detail, status: event.properties.status }
  }

  if (event.type === "session.idle") {
    return { ...detail, status: { type: "idle" as const } }
  }

  if (event.type === "permission.asked") {
    const alreadyPresent = detail.permissions.some((item) => item.id === event.properties.id)
    if (alreadyPresent) return detail
    return { ...detail, permissions: [...detail.permissions, event.properties] }
  }

  if (event.type === "permission.replied") {
    return {
      ...detail,
      permissions: detail.permissions.filter((item) => item.id !== event.properties.requestID),
    }
  }

  if (event.type === "question.asked") {
    const alreadyPresent = detail.questions.some((item) => item.id === event.properties.id)
    if (alreadyPresent) return detail
    return { ...detail, questions: [...detail.questions, event.properties] }
  }

  if (event.type === "question.replied" || event.type === "question.rejected") {
    return {
      ...detail,
      questions: detail.questions.filter((item) => item.id !== event.properties.requestID),
    }
  }

  return detail
}

export function sessionErrorMessage(event: NikcliEvent) {
  if (event.type !== "session.error") return null

  const error = event.properties.error
  if (!error || typeof error !== "object") return "Session failed"

  if ("data" in error && error.data && typeof error.data === "object" && "message" in error.data) {
    const message = error.data.message
    if (typeof message === "string" && message.trim()) return message
  }

  if ("message" in error) {
    const message = error.message
    if (typeof message === "string" && message.trim()) return message
  }

  return "Session failed"
}

export function parseSlashCommand(value: string) {
  const trimmed = value.trim()
  if (!trimmed.startsWith("/")) return null

  const match = trimmed.match(/^\/([^\s]+)\s*(.*)$/s)
  if (!match) return null

  return {
    command: match[1],
    argumentsText: match[2] ?? "",
  }
}

export function messagePlainText(message: MessageWithParts) {
  const text = message.parts
    .filter((part): part is Extract<MessageWithParts["parts"][number], { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("\n\n")
    .trim()

  if (text) return text

  if (message.info.role === "assistant") {
    const maybeMessage = message.info.error?.data?.message
    return typeof maybeMessage === "string" ? maybeMessage.trim() : ""
  }

  return ""
}

export function reasoningText(message: MessageWithParts) {
  return message.parts
    .filter(
      (part): part is Extract<MessageWithParts["parts"][number], { type: "reasoning" }> => part.type === "reasoning",
    )
    .map((part) => (typeof part.text === "string" ? part.text.trim() : ""))
    .filter(Boolean)
    .join("\n\n")
}

export function toolParts(message: MessageWithParts) {
  return message.parts.filter(
    (part): part is Extract<MessageWithParts["parts"][number], { type: "tool" }> => part.type === "tool",
  )
}

export function patchPart(message: MessageWithParts) {
  return message.parts.find(
    (part): part is Extract<MessageWithParts["parts"][number], { type: "patch" }> => part.type === "patch",
  )
}
