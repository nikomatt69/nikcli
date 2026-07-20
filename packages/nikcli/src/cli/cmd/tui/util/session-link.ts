import type { useKV } from "@tui/context/kv"

/** Bidirectional pairing of session IDs the user has explicitly linked via the tab bar. */
export type SessionLinkMap = Record<string, string>

const SESSION_LINKS_KEY = "session_links_v1"

type KV = ReturnType<typeof useKV>

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
