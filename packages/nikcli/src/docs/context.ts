import path from "path"
import { mkdir } from "fs/promises"
import { Global } from "@/global"
import { getAllDocs, type DocEntry } from "./library"

type DocsContext = {
  ids: string[]
  updatedAt: number
}

const DIR = path.join(Global.Path.data, "docs")
const FILE = path.join(DIR, "context.json")
const MAX_SUMMARY_CHARS = 4000
const MAX_FULL_CHARS = 20000

async function ensureDir() {
  await mkdir(DIR, { recursive: true })
}

async function readContext(): Promise<DocsContext> {
  const file = Bun.file(FILE)
  const exists = await file.exists()
  if (!exists) return { ids: [], updatedAt: Date.now() }
  const data = await file.json().catch(() => null)
  if (!data || !Array.isArray(data.ids)) return { ids: [], updatedAt: Date.now() }
  return {
    ids: data.ids,
    updatedAt: typeof data.updatedAt === "number" ? data.updatedAt : Date.now(),
  }
}

async function writeContext(context: DocsContext): Promise<void> {
  await ensureDir()
  await Bun.write(FILE, JSON.stringify(context, null, 2))
}

function unique(ids: string[]): string[] {
  return Array.from(new Set(ids))
}

export async function loadDocs(ids: string[]): Promise<{ loaded: DocEntry[]; missing: string[] }> {
  const ctx = await readContext()
  const all = await getAllDocs()
  const valid = all.filter((entry) => ids.some((id) => matches(entry, id)))
  const foundIds = valid.map((entry) => entry.id)
  const missing = ids.filter((id) => !all.some((entry) => matches(entry, id)))
  const next = unique([...ctx.ids, ...foundIds])
  await writeContext({ ids: next, updatedAt: Date.now() })
  return { loaded: valid, missing }
}

export async function unloadDocs(ids?: string[]): Promise<{ removed: string[] }> {
  const ctx = await readContext()
  if (!ids || ids.length === 0) {
    await writeContext({ ids: [], updatedAt: Date.now() })
    return { removed: ctx.ids }
  }
  const all = await getAllDocs()
  const loaded = ctx.ids
    .map((id) => all.find((entry) => entry.id === id))
    .filter((entry): entry is DocEntry => Boolean(entry))
  const toRemove = loaded.filter((entry) => ids.some((id) => matches(entry, id))).map((entry) => entry.id)
  const removed = ctx.ids.filter((id) => toRemove.includes(id))
  const next = ctx.ids.filter((id) => !toRemove.includes(id))
  await writeContext({ ids: next, updatedAt: Date.now() })
  return { removed }
}

export async function getLoadedDocs(): Promise<DocEntry[]> {
  const ctx = await readContext()
  if (ctx.ids.length === 0) return []
  const docs = await getAllDocs()
  const sorted = ctx.ids
    .map((id) => docs.find((entry) => entry.id === id))
    .filter((entry): entry is DocEntry => Boolean(entry))
  return sorted
}

function summaryLine(entry: DocEntry): string {
  const tags = entry.tags.length > 0 ? ` tags: ${entry.tags.join(", ")}` : ""
  return `- ${entry.title} (${entry.category})${tags}`
}

function matches(entry: DocEntry, key: string): boolean {
  const lower = key.toLowerCase()
  if (entry.id === key) return true
  if (entry.url.toLowerCase().includes(lower)) return true
  if (entry.title.toLowerCase().includes(lower)) return true
  if (entry.tags.some((tag) => tag.toLowerCase().includes(lower))) return true
  return false
}

export async function getContextSummary(): Promise<string> {
  const docs = await getLoadedDocs()
  if (docs.length === 0) return "No documentation loaded."
  const lines = docs.map(summaryLine)
  const summary = `Documentation context (${docs.length} docs)\n` + lines.join("\n")
  if (summary.length <= MAX_SUMMARY_CHARS) return summary
  return summary.slice(0, MAX_SUMMARY_CHARS) + "\n[summary truncated]"
}

export async function getFullContext(): Promise<string> {
  const docs = await getLoadedDocs()
  if (docs.length === 0) return ""
  const chunks = docs.map((entry) => {
    return [
      `## ${entry.title}`,
      `Category: ${entry.category}`,
      entry.tags.length > 0 ? `Tags: ${entry.tags.join(", ")}` : "",
      entry.url ? `Source: ${entry.url}` : "",
      "",
      entry.content,
    ]
      .filter(Boolean)
      .join("\n")
  })
  const content = `# DOCUMENTATION CONTEXT\n\n` + chunks.join("\n\n---\n\n")
  if (content.length <= MAX_FULL_CHARS) return content
  return content.slice(0, MAX_FULL_CHARS) + "\n[context truncated]"
}
