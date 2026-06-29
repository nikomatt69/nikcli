// Parses the bundled CHANGELOG.md (synced from the monorepo root at build time
// by script/sync-changelog.ts) into structured, render-ready release entries.
import changelogRaw from "../data/changelog.md?raw"

export interface ChangelogEntry {
  /** Stable anchor id, e.g. "v1-129-0" */
  id: string
  /** Display title, e.g. "v1.129.0" or "Week of February 3, 2026" */
  title: string
  /** Semantic version when the heading is a vX.Y.Z release, else null */
  version: string | null
  /** Human date label parsed from the heading, e.g. "June 2026" */
  date: string | null
  /** True for the legacy "Week of …" weekly notes */
  isWeekly: boolean
  /** Short one-line summary derived from the first meaningful body line */
  summary: string
  /** Rendered HTML body */
  bodyHtml: string
  /** True when the body has no notable changes */
  empty: boolean
}

const escapeHtml = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

/** Minimal inline markdown → HTML for the controlled changelog content. */
const renderInline = (text: string): string => {
  let out = escapeHtml(text)
  // links [label](url)
  out = out.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noreferrer" class="text-terminal-accent underline underline-offset-2 decoration-terminal-accent/40 hover:decoration-terminal-accent">$1</a>',
  )
  // inline code
  out = out.replace(
    /`([^`]+)`/g,
    '<code class="rounded-[5px] border border-terminal-border/60 bg-terminal-code/70 px-1.5 py-0.5 font-mono text-[0.82em] text-terminal-text">$1</code>',
  )
  // bold
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong class="font-semibold text-terminal-text">$1</strong>')
  // @handle → muted mono chip
  out = out.replace(
    /(^|[\s(])@([a-zA-Z0-9_-]+)/g,
    '$1<span class="font-mono text-[0.85em] text-terminal-muted">@$2</span>',
  )
  return out
}

/** Render a version body block (already stripped of the version heading). */
const renderBody = (lines: string[]): string => {
  const html: string[] = []
  let inList = false
  const closeList = () => {
    if (inList) {
      html.push("</ul>")
      inList = false
    }
  }

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/, "")
    if (!line.trim()) {
      continue
    }
    // strip html comments (UNRELEASED markers etc.)
    if (/^<!--/.test(line.trim())) continue
    if (line.trim() === "---") continue

    // sub-headings: "## Desktop", "### Highlights", etc.
    const head = line.match(/^(#{2,4})\s+(.*)$/)
    if (head) {
      closeList()
      html.push(
        `<h3 class="mt-5 mb-2 font-display text-[0.78rem] font-bold uppercase tracking-[0.14em] text-terminal-muted first:mt-0">${renderInline(
          head[2],
        )}</h3>`,
      )
      continue
    }

    // list items (support one level of nesting)
    const li = line.match(/^(\s*)-\s+(.*)$/)
    if (li) {
      if (!inList) {
        html.push(
          '<ul class="space-y-1.5 text-[14px] leading-[1.65] text-terminal-muted marker:text-terminal-accent/60">',
        )
        inList = true
      }
      const nested = li[1].length >= 2
      html.push(`<li class="${nested ? "ml-5 list-[circle]" : "list-disc"} ml-5">${renderInline(li[2])}</li>`)
      continue
    }

    closeList()
    html.push(`<p class="text-[14px] leading-[1.7] text-terminal-muted">${renderInline(line)}</p>`)
  }
  closeList()
  return html.join("\n")
}

/** Render a standalone markdown block (e.g. a GitHub release body) to HTML. */
export const renderMarkdownBlock = (md: string): string => renderBody(md.split(/\r?\n/))

export const slugify = (title: string): string =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")

const VERSION_HEADING = /^##\s+(v\d+[\w.]*|Week of .+?)\s*(?:\(([^)]+)\))?\s*$/

export function parseChangelog(raw: string = changelogRaw): ChangelogEntry[] {
  const lines = raw.split(/\r?\n/)
  const entries: ChangelogEntry[] = []

  let current: { title: string; date: string | null; body: string[] } | null = null
  const flush = () => {
    if (!current) return
    const versionMatch = current.title.match(/^v(\d+\.\d+\.\d+\S*)$/)
    const bodyText = current.body.join("\n")
    const empty = /no notable changes/i.test(bodyText) && current.body.filter((l) => l.trim()).length <= 1

    // first meaningful body line for the summary
    let summary = ""
    for (const l of current.body) {
      const li = l.match(/^\s*-\s+(.*)$/)
      if (li) {
        summary = li[1].replace(/\s*\(@[^)]+\)\s*$/, "").replace(/[*`]/g, "")
        break
      }
    }
    if (!summary) summary = empty ? "No notable changes" : "Release notes"

    entries.push({
      id: slugify(current.title),
      title: current.title,
      version: versionMatch ? versionMatch[1] : null,
      date: current.date,
      isWeekly: /^Week of/i.test(current.title),
      summary,
      bodyHtml: renderBody(current.body),
      empty,
    })
  }

  for (const line of lines) {
    const m = line.match(VERSION_HEADING)
    if (m) {
      flush()
      current = { title: m[1].trim(), date: m[2]?.trim() ?? null, body: [] }
      continue
    }
    // skip the top-level "# Changelog" title and stray comments before first version
    if (!current) continue
    current.body.push(line)
  }
  flush()

  return entries
}

export const changelogEntries: ChangelogEntry[] = parseChangelog()

export const latestVersion: string | null = changelogEntries.find((e) => e.version)?.version ?? null
