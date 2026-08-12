import type { Part } from "@nikcli-ai/sdk/httpapi"
import type { useKV } from "@tui/context/kv"
import type { useSDK } from "@tui/context/sdk"
import type { useSync } from "@tui/context/sync"
import { Identifier } from "@/id/id"

/** Bidirectional pairing of session IDs the user has explicitly linked via the tab bar. */
export type SessionLinkMap = Record<string, string>

const SESSION_LINKS_KEY = "session_links_v1"
const MAX_RELAY_CHARS = 4000

type KV = ReturnType<typeof useKV>
type SDK = ReturnType<typeof useSDK>
type Sync = ReturnType<typeof useSync>

function readLinks(kv: KV): SessionLinkMap {
  return kv.get(SESSION_LINKS_KEY, {} as SessionLinkMap) as SessionLinkMap
}

export function sessionLinkOf(kv: KV, sessionID: string): string | undefined {
  return readLinks(kv)[sessionID]
}

/** Links two sessions together (both directions) so either tab can relay into the other. */
export function linkSessions(kv: KV, a: string, b: string) {
  const next = { ...readLinks(kv) }
  next[a] = b
  next[b] = a
  kv.set(SESSION_LINKS_KEY, next)
}

/** Removes the link for a session and its partner, if any. */
export function unlinkSession(kv: KV, sessionID: string) {
  const next = { ...readLinks(kv) }
  const partner = next[sessionID]
  delete next[sessionID]
  if (partner) delete next[partner]
  kv.set(SESSION_LINKS_KEY, next)
}

function isTextPart(part: Part): part is Extract<Part, { type: "text" }> {
  return part.type === "text"
}

/** Builds the text of the latest turn in `sourceSessionID`, wrapped as a system-reminder for a linked partner. */
export function buildRelayText(sync: Sync, sourceSessionID: string, kind: "link" | "wake" = "link"): string {
  const source = sync.session.get(sourceSessionID)
  const label = source?.title || `Session ${sourceSessionID.slice(-5)}`
  const messages = sync.data.message[sourceSessionID] ?? []
  const last = messages.at(-1)
  const parts = last ? (sync.data.part[last.id] ?? []) : []
  const text = parts
    .filter(isTextPart)
    .map((part) => part.text)
    .join("\n")
    .trim()
  if (!text) {
    return `<system-reminder>Session "${label}" linked to this session and wants to connect. There is no recent message to relay yet.</system-reminder>`
  }
  const truncated = text.length > MAX_RELAY_CHARS ? `${text.slice(0, MAX_RELAY_CHARS)}\n…(truncated)` : text
  const verb = kind === "wake" ? "Update" : "Message"
  return `<system-reminder>${verb} relayed from linked session "${label}":</system-reminder>\n${truncated}`
}

/** Delivers relay text into a session. `noReply` keeps it a passive note (no agent turn spent replying). */
export async function relayToSession(sdk: SDK, targetSessionID: string, text: string, opts?: { noReply?: boolean }) {
  await sdk.client.session
    .promptAsync({
      sessionID: targetSessionID,
      noReply: opts?.noReply ?? false,
      parts: [
        {
          id: Identifier.ascending("part"),
          type: "text",
          text,
          synthetic: true,
        },
      ],
    })
    .catch(() => undefined)
}
