import type { useKV } from "../context/kv"

export const BACKGROUND_DISMISSED_KEY = "tui:background_subtasks_dismissed"
const LEGACY_KEY = "background_subtasks_dismissed"

export type BackgroundDismissedMap = Record<string, string[]>

type KV = ReturnType<typeof useKV>

function readMap(kv: KV): BackgroundDismissedMap {
  const next = kv.get(BACKGROUND_DISMISSED_KEY) as BackgroundDismissedMap | undefined
  if (next) return next
  const legacy = kv.get(LEGACY_KEY) as BackgroundDismissedMap | undefined
  return legacy ?? {}
}

export function getBackgroundDismissed(kv: KV, parentID: string): Set<string> {
  const map = readMap(kv)
  return new Set(map[parentID] ?? [])
}

export function dismissBackground(kv: KV, parentID: string, delegationID: string) {
  const map = readMap(kv)
  const next = Array.from(new Set([...(map[parentID] ?? []), delegationID]))
  kv.set(BACKGROUND_DISMISSED_KEY, { ...map, [parentID]: next })
}

export function undismissBackground(kv: KV, parentID: string, delegationID: string) {
  const map = readMap(kv)
  const next = (map[parentID] ?? []).filter((id) => id !== delegationID)
  kv.set(BACKGROUND_DISMISSED_KEY, { ...map, [parentID]: next })
}
