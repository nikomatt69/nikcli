/**
 * Out-of-band blob store for prompt attachments (images).
 *
 * Implements `specs/opencode-parity/01-prompt-history-payload-limits.md`: keep base64
 * image payloads OUT of the plaintext `prompt-history.jsonl`. History entries persist a
 * lightweight `blobID` reference; the bytes live one-file-per-blob under the state dir and
 * are hydrated lazily only when an entry is recalled.
 *
 * All operations are best-effort and never throw to the caller — a missing/broken blob
 * degrades to "image unavailable", it does not crash the TUI.
 */

import path from "path"
import { Global } from "@/global"

const BLOB_DIR = "prompt-blobs"

function blobDir(): string {
  return path.join(Global.Path.state, BLOB_DIR)
}

function blobPath(blobID: string): string {
  // blobID is generated locally (no path separators); guard anyway.
  return path.join(blobDir(), blobID.replace(/[^a-zA-Z0-9_-]/g, ""))
}

function newBlobID(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/** Convert a `data:<mime>;base64,<...>` URL into raw bytes + mime, or undefined. */
export function parseDataUrl(url: string): { bytes: Uint8Array; mime: string } | undefined {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(url)
  if (!match) return undefined
  const mime = match[1] || "application/octet-stream"
  const isBase64 = !!match[2]
  try {
    const bytes = isBase64
      ? Uint8Array.from(Buffer.from(match[3], "base64"))
      : new TextEncoder().encode(decodeURIComponent(match[3]))
    return { bytes, mime }
  } catch {
    return undefined
  }
}

export function toDataUrl(bytes: Uint8Array, mime: string): string {
  return `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`
}

/** Collect `source.blobID` references from persisted file parts (history/stash JSONL). */
export function collectBlobIDsFromParts(parts: unknown[]): Set<string> {
  const ids = new Set<string>()
  for (const raw of parts) {
    if (typeof raw !== "object" || raw === null) continue
    const part = raw as Record<string, unknown>
    if (part.type !== "file") continue
    const source = part.source as Record<string, unknown> | undefined
    const blobID = source?.blobID
    if (typeof blobID === "string" && blobID) ids.add(blobID)
  }
  return ids
}

export type PromptPersistShape = {
  input: string
  mode?: "normal" | "shell"
  parts: unknown[]
}

async function dehydrateParts(parts: unknown[]): Promise<unknown[]> {
  return Promise.all(
    parts.map(async (raw) => {
      if (typeof raw !== "object" || raw === null) return raw
      const part = raw as Record<string, unknown> & { type?: string }
      if (part.type !== "file") return raw
      const source = (part.source as Record<string, unknown> | undefined) ?? {}
      if (source.blobID) return { ...part, url: undefined, source }
      const url = part.url
      if (typeof url === "string" && url.startsWith("data:")) {
        const blobID = await PromptBlob.putDataUrl(url)
        if (blobID) return { ...part, url: undefined, source: { ...source, blobID } }
        return { ...part, url: undefined }
      }
      return raw
    }),
  )
}

async function hydrateParts(parts: unknown[]): Promise<unknown[]> {
  return Promise.all(
    parts.map(async (raw) => {
      if (typeof raw !== "object" || raw === null) return raw
      const part = raw as Record<string, unknown> & { type?: string }
      if (part.type !== "file") return raw
      const blobID = (part.source as Record<string, unknown> | undefined)?.blobID
      const hasUrl = typeof part.url === "string" && (part.url as string).length > 0
      if (typeof blobID === "string" && !hasUrl) {
        const bytes = await PromptBlob.get(blobID)
        if (bytes) {
          const mime = typeof part.mime === "string" ? part.mime : "application/octet-stream"
          return { ...part, url: toDataUrl(bytes, mime) }
        }
      }
      return raw
    }),
  )
}

/** Strip base64 image payloads to the blob store before writing JSONL. Never throws. */
export async function dehydratePromptEntry<T extends PromptPersistShape>(entry: T): Promise<T> {
  const parts = await dehydrateParts(entry.parts)
  return { ...entry, parts }
}

/** Rebuild in-memory `data:` urls from blob refs. Missing blobs are left as-is. Never throws. */
export async function hydratePromptEntry<T extends PromptPersistShape>(entry: T): Promise<T> {
  const parts = await hydrateParts(entry.parts)
  return { ...entry, parts }
}

export const DEFAULT_MAX_ENTRY_BYTES = 128 * 1024
const TEXT_TRUNCATE_AT = 2000

/**
 * Bound a persisted entry's serialized size (spec 01 `onOversize: truncate`). When the JSON
 * exceeds `maxBytes`, oversized text-part values are truncated with a marker so the file can
 * never balloon from a huge paste. Image payloads are already out-of-band via dehydration.
 */
export function capPromptEntryBytes<T extends PromptPersistShape>(entry: T, maxBytes = DEFAULT_MAX_ENTRY_BYTES): T {
  if (new TextEncoder().encode(JSON.stringify(entry)).length <= maxBytes) return entry
  const parts = entry.parts.map((raw) => {
    if (typeof raw !== "object" || raw === null) return raw
    const part = raw as Record<string, unknown> & { type?: string; text?: unknown }
    if (part.type === "text" && typeof part.text === "string" && part.text.length > TEXT_TRUNCATE_AT) {
      const text = part.text
      return {
        ...part,
        text: `${text.slice(0, TEXT_TRUNCATE_AT)}\n…[truncated ${text.length - TEXT_TRUNCATE_AT} chars]`,
      }
    }
    return raw
  })
  return { ...entry, parts }
}

export const PromptBlob = {
  /** Store bytes, returning a blobID. Returns undefined if the write fails. */
  async put(bytes: Uint8Array, _meta?: { mime?: string; filename?: string }): Promise<string | undefined> {
    const blobID = newBlobID()
    try {
      await Bun.write(blobPath(blobID), bytes)
      return blobID
    } catch {
      return undefined
    }
  },

  /** Convenience: store a data URL, returning its blobID. */
  async putDataUrl(url: string): Promise<string | undefined> {
    const parsed = parseDataUrl(url)
    if (!parsed) return undefined
    return PromptBlob.put(parsed.bytes, { mime: parsed.mime })
  },

  /** Read bytes back, or undefined if missing/unreadable. */
  async get(blobID: string): Promise<Uint8Array | undefined> {
    try {
      const file = Bun.file(blobPath(blobID))
      if (!(await file.exists())) return undefined
      return new Uint8Array(await file.arrayBuffer())
    } catch {
      return undefined
    }
  },

  async remove(blobID: string): Promise<void> {
    await Bun.file(blobPath(blobID))
      .delete()
      .catch(() => {})
  },

  /**
   * TTL garbage-collection: delete blob files older than `ttlMs` whose id is not in
   * `referenced`. Returns the number of blobs removed. Best-effort.
   */
  async gc(referenced: Set<string>, ttlMs: number): Promise<number> {
    let removed = 0
    try {
      const fs = await import("fs/promises")
      const dir = blobDir()
      const entries = await fs.readdir(dir).catch(() => [] as string[])
      const cutoff = Date.now() - ttlMs
      for (const name of entries) {
        if (referenced.has(name)) continue
        const full = path.join(dir, name)
        const stat = await fs.stat(full).catch(() => undefined)
        if (stat && stat.mtimeMs < cutoff) {
          await fs.rm(full).catch(() => {})
          removed += 1
        }
      }
    } catch {
      // ignore
    }
    return removed
  },

  dir: blobDir,
}
