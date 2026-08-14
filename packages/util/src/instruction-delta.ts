import { getFilename, truncateMiddle } from "./path"

export const INSTRUCTION_REMOVED = "removed"
export const INSTRUCTION_NOTICE_LIMIT = 20
export const INSTRUCTION_NOTICE_VISIBLE = 3
const URL_LABEL_MAX = 56

export type InstructionDelta = Record<string, string>

export type InstructionNotice = {
  delta: InstructionDelta
  at: number
  /** Complete first admit for this client: stored, not rendered as chrome. */
  initial: boolean
}

/**
 * First event for a session is the complete snapshot when it names more than
 * one source. A later one-key event (typical file edit), or a first event that
 * is already a single key (forked session's first real change), is visible.
 */
export function isInitialInstructionDelta(existingCount: number, delta: InstructionDelta): boolean {
  return existingCount === 0 && Object.keys(delta).length > 1
}

export function formatInstructionKey(key: string): string {
  if (key === "env") return "environment"
  if (key === "profile") return "profile"
  if (key.startsWith("file:")) {
    const path = key.slice("file:".length)
    return getFilename(path) || path
  }
  if (key.startsWith("url:")) {
    const url = key.slice("url:".length)
    return truncateMiddle(url, URL_LABEL_MAX) || url
  }
  if (key.startsWith("skill:")) return `skill ${key.slice("skill:".length)}`
  return key
}

export function formatInstructionChange(key: string, value: string): string {
  const label = formatInstructionKey(key)
  return value === INSTRUCTION_REMOVED ? `${label} removed` : label
}

/** Labels only. Never include hashes or bodies. */
export function formatInstructionDelta(delta: InstructionDelta): string {
  return Object.entries(delta)
    .map(([key, value]) => formatInstructionChange(key, value))
    .join(" · ")
}

export function appendInstructionNotice(
  existing: InstructionNotice[] | undefined,
  delta: InstructionDelta,
  at: number,
): InstructionNotice[] {
  const keys = Object.keys(delta)
  if (keys.length === 0) return existing ?? []
  const list = existing ?? []
  const next: InstructionNotice = {
    delta,
    at,
    initial: isInitialInstructionDelta(list.length, delta),
  }
  const out = [...list, next]
  return out.length > INSTRUCTION_NOTICE_LIMIT ? out.slice(-INSTRUCTION_NOTICE_LIMIT) : out
}

export function visibleInstructionNotices(
  notices: InstructionNotice[] | undefined,
  limit = INSTRUCTION_NOTICE_VISIBLE,
): InstructionNotice[] {
  return (notices ?? []).filter((notice) => !notice.initial).slice(-limit)
}
