import type { Message, Part, Session, TextPart } from "@nikcli-ai/sdk/v2"
import { formatMessageLineForTimeline } from "@tui/util/timeline-style-text"

export type TreeRow =
  | {
      kind: "session"
      session: Session
      depth: number
      hasChildSessions: boolean
      hasUserMessages: boolean
      hasChildren: boolean
      childSessionsOpen: boolean
      messageTimelineOpen: boolean
      isLast: boolean
      ancestorIsLast: boolean[]
    }
  | {
      kind: "user_message"
      parentSession: Session
      messageId: string
      depth: number
      preview: string
      time: number
      isLast: boolean
      ancestorIsLast: boolean[]
    }

type SyncData = {
  message: Record<string, Message[] | undefined>
  part: Record<string, Part[] | undefined>
}

export function listUserMessagePreviews(
  data: SyncData,
  sessionId: string,
): { messageId: string; preview: string; time: number }[] {
  const list = (data.message[sessionId] ?? []).filter((m) => m.role === "user")
  const out: { messageId: string; preview: string; time: number }[] = []
  for (const m of list) {
    const part = (data.part[m.id] ?? []).find(
      (x): x is TextPart => x.type === "text" && !x.synthetic && !x.ignored,
    )
    if (!part) continue
    out.push({
      messageId: m.id,
      preview: formatMessageLineForTimeline(part.text),
      time: m.time.created,
    })
  }
  return out
}

export function flattenTreeRows(
  roots: Session[],
  childrenByParent: Map<string, Session[]>,
  childSessionsOpen: Set<string>,
  messageTimelineOpen: Set<string>,
  data: SyncData,
): TreeRow[] {
  const result: TreeRow[] = []

  function visit(session: Session, depth: number, isLast: boolean, ancestorIsLast: boolean[]) {
    const childSessions = childrenByParent.get(session.id) ?? []
    const cOpen = childSessionsOpen.has(session.id)
    const mOpen = messageTimelineOpen.has(session.id)
    const userMsgs = listUserMessagePreviews(data, session.id)
    const hasUserMessages = userMsgs.length > 0
    const hasChildSessions = childSessions.length > 0
    const hasChildren = hasUserMessages || hasChildSessions
    const nextAncestors = [...ancestorIsLast, isLast]

    result.push({
      kind: "session",
      session,
      depth,
      hasChildSessions,
      hasUserMessages,
      hasChildren,
      childSessionsOpen: cOpen,
      messageTimelineOpen: mOpen,
      isLast,
      ancestorIsLast: [...ancestorIsLast],
    })

    if (!mOpen && !cOpen) return

    if (mOpen) {
      const M = userMsgs.length
      const hasChildAfter = hasChildSessions && cOpen
      for (let j = 0; j < M; j++) {
        const m = userMsgs[j]!
        const isLastInBlock = j === M - 1 && !hasChildAfter
        result.push({
          kind: "user_message",
          parentSession: session,
          messageId: m.messageId,
          depth: depth + 1,
          preview: m.preview,
          time: m.time,
          isLast: isLastInBlock,
          ancestorIsLast: nextAncestors,
        })
      }
    }

    if (cOpen) {
      childSessions.forEach((ch, i) => visit(ch, depth + 1, i === childSessions.length - 1, nextAncestors))
    }
  }

  roots.forEach((root, i) => visit(root, 0, i === roots.length - 1, []))
  return result
}

export function treeLinePrefix(row: TreeRow): string {
  if (row.kind === "user_message") {
    const d = row.depth
    if (d === 0) return ""
    const { isLast, ancestorIsLast } = row
    return prefixFromDepth(ancestorIsLast, isLast, d)
  }
  const d = row.depth
  if (d === 0) return ""
  return prefixFromDepth(row.ancestorIsLast, row.isLast, d)
}

function prefixFromDepth(ancestorIsLast: boolean[], isLast: boolean, depth: number): string {
  let s = ""
  for (let i = 0; i < depth - 1; i++) {
    s += ancestorIsLast[i] ? "    " : "│   "
  }
  s += (isLast ? "└" : "├") + "── "
  return s
}
