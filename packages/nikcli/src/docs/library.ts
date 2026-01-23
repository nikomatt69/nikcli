import path from "path"
import { mkdir } from "fs/promises"
import { randomUUID } from "crypto"
import TurndownService from "turndown"
import { Global } from "@/global"

export type DocEntry = {
  id: string
  url: string
  title: string
  content: string
  category: string
  tags: string[]
  addedAt: number
}

export type DocSearchResult = {
  entry: DocEntry
  score: number
  snippet: string
  terms: string[]
}

const DIR = path.join(Global.Path.data, "docs")
const LIB = path.join(DIR, "library.json")
const MAX_CONTENT = 60000
const MIN_CONTENT = 200

const turndown = new TurndownService({
  codeBlockStyle: "fenced",
  headingStyle: "atx",
})

async function ensureDir() {
  await mkdir(DIR, { recursive: true })
}

async function readAll(): Promise<DocEntry[]> {
  const file = Bun.file(LIB)
  const exists = await file.exists()
  if (!exists) return []
  const data = await file.json()
  const list = Array.isArray(data) ? data : []
  return list as DocEntry[]
}

async function writeAll(list: DocEntry[]): Promise<void> {
  await ensureDir()
  await Bun.write(LIB, JSON.stringify(list, null, 2))
}

function cleanHtml(html: string): string {
  const noScript = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
  const noStyle = noScript.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
  return noStyle
}

function toText(html: string): string {
  const cleaned = cleanHtml(html)
  const text = turndown.turndown(cleaned)
  return text.replace(/\n{3,}/g, "\n\n").trim()
}

function getTitle(html: string, url: string): string {
  const match = html.match(/<title[^>]*>([^<]+)<\/title>/i)
  if (match?.[1]) return match[1].trim().slice(0, 120)
  return url
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function terms(text: string): string[] {
  const list = normalize(text).split(" ").filter(Boolean)
  if (list.length === 0) return []
  return Array.from(new Set(list))
}

function score(entry: DocEntry, query: string): { score: number; terms: string[] } {
  const items = terms(query)
  if (items.length === 0) return { score: 0, terms: [] }
  const title = normalize(entry.title)
  const body = normalize(entry.content)
  const tags = entry.tags.map((tag) => normalize(tag)).join(" ")
  const base = items.reduce((sum, item) => {
    const inTitle = title.includes(item) ? 2 : 0
    const inBody = body.includes(item) ? 1 : 0
    const inTags = tags.includes(item) ? 1 : 0
    return sum + inTitle + inBody + inTags
  }, 0)
  const value = base / items.length
  return { score: value, terms: items }
}

function snippet(entry: DocEntry, query: string): string {
  const items = terms(query)
  const text = entry.content
  const lower = text.toLowerCase()
  const idx = items
    .map((item) => lower.indexOf(item))
    .filter((val) => val >= 0)
    .sort((a, b) => a - b)[0]
  if (idx === undefined) return text.slice(0, 200)
  const start = Math.max(0, idx - 80)
  const end = Math.min(text.length, idx + 140)
  return text.slice(start, end).replace(/\s+/g, " ").trim()
}

function match(entry: DocEntry, key: string): boolean {
  const lower = key.toLowerCase()
  if (entry.id === key) return true
  if (entry.url.toLowerCase().includes(lower)) return true
  if (entry.title.toLowerCase().includes(lower)) return true
  if (entry.tags.some((tag) => tag.toLowerCase().includes(lower))) return true
  return false
}

export async function addDoc(input: { url: string; category?: string; tags?: string[] }): Promise<DocEntry> {
  const res = await fetch(input.url)
  if (!res.ok) {
    throw new Error(`Docs fetch failed: ${res.status} ${res.statusText}`)
  }
  const html = await res.text()
  const title = getTitle(html, input.url)
  const text = toText(html)
  if (text.length < MIN_CONTENT) {
    throw new Error("Docs content too short to index")
  }

  const entry: DocEntry = {
    id: randomUUID(),
    url: input.url,
    title,
    content: text.slice(0, MAX_CONTENT),
    category: input.category || "general",
    tags: (input.tags ?? []).filter(Boolean),
    addedAt: Date.now(),
  }

  await ensureDir()
  const list = await readAll()
  const next = [entry, ...list]
  await writeAll(next)
  return entry
}

export async function listDocs(category?: string): Promise<DocEntry[]> {
  const list = await readAll()
  if (!category) return list
  return list.filter((item) => item.category === category)
}

export async function getAllDocs(): Promise<DocEntry[]> {
  return readAll()
}

export async function getDoc(key: string): Promise<DocEntry | undefined> {
  const list = await readAll()
  return list.find((entry) => match(entry, key))
}

export async function getDocs(keys: string[]): Promise<DocEntry[]> {
  const list = await readAll()
  return list.filter((entry) => keys.some((key) => match(entry, key)))
}

export async function searchDocs(query: string, category?: string, limit = 5): Promise<DocSearchResult[]> {
  const list = await readAll()
  const items = category ? list.filter((item) => item.category === category) : list
  const scored = items
    .map((entry) => {
      const result = score(entry, query)
      return {
        entry,
        score: result.score,
        snippet: snippet(entry, query),
        terms: result.terms,
      }
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
  return scored
}
