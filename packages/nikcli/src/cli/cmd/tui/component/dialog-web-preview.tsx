import { TextAttributes, TextareaRenderable } from "@opentui/core"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import TurndownService from "turndown"
import { useDialog } from "@tui/ui/dialog"
import { useTheme } from "@tui/context/theme"

type FocusArea = "url" | "content"

type PageState = {
  loading: boolean
  error: string | null
  url: string
  title: string
  description: string
  markdown: string
  headings: Heading[]
  sections: Section[]
  links: Link[]
}

type Heading = { level: number; text: string; slug: string }
type Section = { level: number; title: string; slug: string; markdown: string }
type Link = { text: string; href: string }

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
  emDelimiter: "*",
})

turndown.remove(["script", "style", "noscript", "iframe", "canvas", "form", "button", "input"])

function stripNoise(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
    .replace(/<header[\s\S]*?<\/header>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<aside[\s\S]*?<\/aside>/gi, "")
}

function extractTitle(html: string) {
  return (
    html
      .match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
      ?.replace(/\s+/g, " ")
      .trim() ?? ""
  )
}

function extractDescription(html: string) {
  return (
    html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)?.[1] ??
    html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i)?.[1] ??
    ""
  )
}

function extractContentRoot(html: string) {
  return (
    html.match(/<main[^>]*>([\s\S]*?)<\/main>/i)?.[1] ??
    html.match(/<article[^>]*>([\s\S]*?)<\/article>/i)?.[1] ??
    html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] ??
    html
  )
}

function normalizeMarkdown(md: string) {
  return md
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim()
}

function decodeHtml(v: string) {
  return v
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, " ")
}

function stripTags(v: string) {
  return decodeHtml(v.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")).trim()
}

function slugify(v: string) {
  return (
    v
      .toLowerCase()
      .replace(/[`*_~[\]()+!?.,:;"']/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "section"
  )
}

function normalizeUrl(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ""
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  return `https://${trimmed}`
}

function hostLabel(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return url
  }
}

function parseStructure(markdown: string): { headings: Heading[]; sections: Section[] } {
  const lines = markdown.split("\n")
  const headings: (Heading & { index: number })[] = []
  const seen = new Map<string, number>()

  for (let i = 0; i < lines.length; i++) {
    const match = /^(#{1,6})\s+(.+)$/.exec(lines[i]?.trim() ?? "")
    if (!match) continue
    const base = slugify(match[2])
    const count = seen.get(base) ?? 0
    seen.set(base, count + 1)
    headings.push({
      level: match[1].length,
      text: match[2].trim(),
      slug: count === 0 ? base : `${base}-${count + 1}`,
      index: i,
    })
  }

  const sections: Section[] = headings.map((h, idx) => {
    let end = lines.length
    for (let next = idx + 1; next < headings.length; next++) {
      if (headings[next]!.level <= h.level) {
        end = headings[next]!.index
        break
      }
    }
    return {
      level: h.level,
      title: h.text,
      slug: h.slug,
      markdown: normalizeMarkdown(lines.slice(h.index, end).join("\n")),
    }
  })

  return { headings: headings.map(({ level, text, slug }) => ({ level, text, slug })), sections }
}

function extractLinks(html: string, baseUrl: string): Link[] {
  const links: Link[] = []
  const seen = new Set<string>()
  const re = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    const href = m[1]?.trim()
    if (!href || href.startsWith("javascript:") || href.startsWith("mailto:") || href.startsWith("tel:")) continue
    let resolved = href
    try {
      resolved = new URL(href, baseUrl).toString()
    } catch { }
    if (seen.has(resolved)) continue
    seen.add(resolved)
    links.push({ href: resolved, text: stripTags(m[2] ?? "") || resolved })
    if (links.length >= 24) break
  }
  return links
}

async function fetchPage(url: string, signal: AbortSignal): Promise<PageState> {
  const res = await fetch(url, {
    signal,
    redirect: "follow",
    headers: {
      "User-Agent": "nikcli-preview/1.0",
      Accept: "text/html,application/xhtml+xml,text/markdown,text/plain;q=0.9,*/*;q=0.8",
    },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)

  const finalUrl = res.url || url
  const ct = res.headers.get("content-type")?.toLowerCase() ?? ""
  const raw = await res.text()

  // Plain markdown
  if (ct.includes("markdown")) {
    const md = normalizeMarkdown(raw)
    const s = parseStructure(md)
    return {
      loading: false,
      error: null,
      url: finalUrl,
      title: hostLabel(finalUrl),
      description: "",
      markdown: md,
      headings: s.headings,
      sections: s.sections,
      links: [],
    }
  }

  // Non-HTML text
  if (!ct.includes("html") && !raw.includes("<html") && !raw.includes("<body")) {
    const fenced = ct.includes("json") ? `\`\`\`json\n${raw.trim()}\n\`\`\`` : raw.trim()
    const md = normalizeMarkdown(fenced)
    const s = parseStructure(md)
    return {
      loading: false,
      error: null,
      url: finalUrl,
      title: hostLabel(finalUrl),
      description: ct,
      markdown: md,
      headings: s.headings,
      sections: s.sections,
      links: [],
    }
  }

  // HTML → markdown
  const cleaned = stripNoise(raw)
  const contentHtml = extractContentRoot(cleaned)
  const md = normalizeMarkdown(turndown.turndown(contentHtml || cleaned))
  const s = parseStructure(md)

  return {
    loading: false,
    error: null,
    url: finalUrl,
    title: extractTitle(raw) || hostLabel(finalUrl),
    description: extractDescription(raw),
    markdown: md || "_No readable content extracted from this page._",
    headings: s.headings,
    sections: s.sections,
    links: extractLinks(contentHtml || cleaned, finalUrl),
  }
}

export type DialogWebPreviewProps = { url?: string }

export function DialogWebPreview(props: DialogWebPreviewProps) {
  const dialog = useDialog()
  const { theme, syntax } = useTheme()
  const dimensions = useTerminalDimensions()
  const initialUrl = props.url ? normalizeUrl(props.url) : ""

  const [address, setAddress] = createSignal(initialUrl)
  const [focusArea, setFocusArea] = createSignal<FocusArea>(initialUrl ? "content" : "url")
  const [historyStack, setHistoryStack] = createSignal<string[]>([])
  const [historyIndex, setHistoryIndex] = createSignal(-1)
  const [page, setPage] = createSignal<PageState>({
    loading: false,
    error: null,
    url: "",
    title: "",
    description: "",
    markdown: "",
    headings: [],
    sections: [],
    links: [],
  })
  const [selectedSection, setSelectedSection] = createSignal<string | null>(null)

  const contentHeight = createMemo(() => {
    const h = dimensions().height
    return Math.max(12, Math.min(h - 14, Math.floor(h * 0.6)))
  })
  const innerHeight = createMemo(() => Math.max(6, contentHeight() - 2))
  const tight = createMemo(() => dimensions().width < 84)
  const wide = createMemo(() => dimensions().width >= 118)
  const canGoBack = createMemo(() => historyIndex() > 0)
  const canGoForward = createMemo(() => historyIndex() < historyStack().length - 1)
  const sectionData = createMemo(() => page().sections.find((s) => s.slug === selectedSection()) ?? null)
  const displayedMarkdown = createMemo(() => sectionData()?.markdown || page().markdown)

  let urlTextarea: TextareaRenderable | undefined
  let abortCtrl: AbortController | undefined
  let reqId = 0

  function focusUrlBar() {
    setFocusArea("url")
    setTimeout(() => {
      if (urlTextarea && !urlTextarea.isDestroyed) {
        urlTextarea.focus()
        urlTextarea.gotoLineEnd()
      }
    }, 1)
  }

  function focusContent() {
    setFocusArea("content")
  }

  async function navigate(rawUrl: string) {
    const url = normalizeUrl(rawUrl)
    if (!url) return
    setAddress(url)
    focusContent()
    setSelectedSection(null)

    const id = ++reqId
    abortCtrl?.abort()
    const abort = new AbortController()
    abortCtrl = abort

    setPage((p) => ({ ...p, loading: true, error: null, url }))

    try {
      const result = await fetchPage(url, abort.signal)
      if (id !== reqId) return
      setPage(result)
      if (result.url) setAddress(result.url)

      const base = historyStack().slice(0, historyIndex() + 1)
      setHistoryStack([...base, result.url])
      setHistoryIndex(base.length)
    } catch (err) {
      if (abort.signal.aborted || id !== reqId) return
      setPage((p) => ({ ...p, loading: false, error: err instanceof Error ? err.message : String(err) }))
    } finally {
      if (abortCtrl === abort) abortCtrl = undefined
    }
  }

  function reload() {
    const target = page().url || address()
    if (target) void navigate(target)
  }

  function goBack() {
    if (!canGoBack()) return
    const idx = historyIndex() - 1
    setHistoryIndex(idx)
    const url = historyStack()[idx]!
    void navigate(url)
  }

  function goForward() {
    if (!canGoForward()) return
    const idx = historyIndex() + 1
    setHistoryIndex(idx)
    const url = historyStack()[idx]!
    void navigate(url)
  }

  onMount(() => {
    dialog.setSize("xlarge")
    if (initialUrl) {
      setTimeout(() => void navigate(initialUrl), 1)
    } else {
      setTimeout(() => focusUrlBar(), 1)
    }
  })

  onCleanup(() => {
    abortCtrl?.abort()
  })

  useKeyboard((evt) => {
    if (focusArea() === "url") return

    if (!evt.ctrl && !evt.meta && !evt.shift && evt.name === "r") {
      reload()
      evt.preventDefault()
      evt.stopPropagation()
      return
    }
    if (!evt.ctrl && !evt.meta && evt.name === "/") {
      focusUrlBar()
      evt.preventDefault()
      evt.stopPropagation()
      return
    }
    if ((evt.meta || evt.option) && evt.name === "left") {
      goBack()
      evt.preventDefault()
      evt.stopPropagation()
      return
    }
    if ((evt.meta || evt.option) && evt.name === "right") {
      goForward()
      evt.preventDefault()
      evt.stopPropagation()
    }
  })

  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between" flexShrink={0}>
        <text fg={theme.primary} attributes={TextAttributes.BOLD}>
          ⊕ Web Preview
        </text>
        <text fg={theme.textMuted}>esc</text>
      </box>

      <box flexDirection="row" gap={1} alignItems="center" flexShrink={0}>
        <text fg={canGoBack() ? theme.text : theme.textMuted} onMouseUp={() => goBack()} flexShrink={0}>
          ←
        </text>
        <text fg={canGoForward() ? theme.text : theme.textMuted} onMouseUp={() => goForward()} flexShrink={0}>
          →
        </text>
        <text fg={page().url ? theme.text : theme.textMuted} onMouseUp={() => reload()} flexShrink={0}>
          ↺
        </text>

        <Show
          when={focusArea() === "url"}
          fallback={
            <text
              fg={address() ? theme.text : theme.textMuted}
              flexGrow={1}
              wrapMode="char"
              onMouseUp={() => focusUrlBar()}
            >
              {address() || "press / or click to enter a URL..."}
            </text>
          }
        >
          <textarea
            ref={(v: TextareaRenderable) => {
              urlTextarea = v
            }}
            initialValue={address()}
            height={1}
            flexGrow={1}
            keyBindings={[{ name: "return", action: "submit" }]}
            onSubmit={() => {
              const v = urlTextarea?.plainText.trim() ?? ""
              urlTextarea?.blur()
              if (!v) {
                focusContent()
                return
              }
              void navigate(v)
            }}
            onKeyPress={(evt) => {
              if (evt.name === "escape") {
                urlTextarea?.blur()
                focusContent()
                evt.preventDefault()
                evt.stopPropagation()
              }
            }}
            placeholder="https://example.com"
            textColor={theme.text}
            focusedTextColor={theme.text}
            cursorColor={theme.primary}
          />
        </Show>

        <box
          backgroundColor={theme.primary}
          paddingLeft={1}
          paddingRight={1}
          flexShrink={0}
          onMouseUp={() => {
            const v = focusArea() === "url" ? (urlTextarea?.plainText.trim() ?? address()) : address()
            if (v) void navigate(v)
          }}
        >
          <text fg={theme.background}>Go</text>
        </box>
      </box>

      <box flexDirection="row" justifyContent="space-between" flexShrink={0}>
        <text fg={page().title ? theme.text : theme.textMuted} attributes={TextAttributes.BOLD} wrapMode="char">
          {page().title || (page().loading ? "Loading..." : "")}
        </text>
        <text fg={page().loading ? theme.primary : page().error ? theme.error : theme.textMuted}>
          {page().loading ? "loading" : page().error ? "error" : page().markdown ? "ready" : ""}
        </text>
      </box>

      <Show when={page().error}>
        <box flexShrink={0}>
          <text fg={theme.error}>✗ {page().error}</text>
        </box>
      </Show>

      <box
        border
        borderColor={focusArea() === "content" ? theme.primary : theme.border}
        focusedBorderColor={theme.primary}
        height={contentHeight()}
        flexShrink={0}
        onMouseUp={() => focusContent()}
      >
        <box flexDirection={wide() ? "row" : "column"} gap={1} paddingLeft={1} paddingRight={1} height={innerHeight()}>
          <scrollbox height={innerHeight()} focused={focusArea() === "content"} flexGrow={1} flexShrink={1}>
            <box gap={1} paddingTop={1} paddingBottom={1}>
              <Show when={page().description}>
                <text fg={theme.textMuted} wrapMode="word">
                  {page().description}
                </text>
              </Show>
              <Show when={sectionData()}>
                <box
                  backgroundColor={theme.backgroundElement}
                  paddingLeft={1}
                  paddingRight={1}
                  paddingTop={1}
                  paddingBottom={1}
                >
                  <text fg={theme.secondary} attributes={TextAttributes.BOLD}>
                    {sectionData()!.title}
                  </text>
                  <text fg={theme.primary} onMouseUp={() => setSelectedSection(null)}>
                    show full page
                  </text>
                </box>
              </Show>
              <Show when={!wide() && (page().headings.length > 0 || page().links.length > 0)}>
                <Sidebar
                  headings={page().headings}
                  links={page().links}
                  selectedSection={selectedSection()}
                  onSelectSection={setSelectedSection}
                  onNavigate={(u) => void navigate(u)}
                />
              </Show>
              <Show
                when={displayedMarkdown()}
                fallback={
                  <text fg={page().loading ? theme.secondary : theme.textMuted} wrapMode="word">
                    {page().loading ? "Fetching and formatting page..." : "Enter a URL above to preview a website."}
                  </text>
                }
              >
                <markdown
                  content={displayedMarkdown()}
                  syntaxStyle={syntax()}
                  fg={theme.text}
                  conceal={true}
                  tableOptions={{
                    widthMode: "full",
                    wrapMode: "word",
                    cellPadding: tight() ? 0 : 1,
                    borders: !tight(),
                    outerBorder: false,
                    borderColor: theme.borderSubtle,
                  }}
                />
              </Show>
            </box>
          </scrollbox>
          <Show when={wide() && (page().headings.length > 0 || page().links.length > 0)}>
            <box width={30} flexShrink={0} height={innerHeight()}>
              <scrollbox height={innerHeight()} paddingLeft={1} paddingRight={1}>
                <Sidebar
                  headings={page().headings}
                  links={page().links}
                  selectedSection={selectedSection()}
                  onSelectSection={setSelectedSection}
                  onNavigate={(u) => void navigate(u)}
                />
              </scrollbox>
            </box>
          </Show>
        </box>
      </box>

      <box
        flexDirection={tight() ? "column" : "row"}
        justifyContent="space-between"
        flexShrink={0}
        gap={tight() ? 1 : 0}
      >
        <text fg={theme.textMuted} wrapMode="char">
          {address() || ""}
        </text>
        <box flexDirection="row" gap={2}>
          <text fg={theme.textMuted}>⌥← back</text>
          <text fg={theme.textMuted}>⌥→ fwd</text>
          <text fg={theme.textMuted}>r reload</text>
          <text fg={theme.textMuted}>/ url</text>
        </box>
      </box>
    </box>
  )
}

function Sidebar(props: {
  headings: Heading[]
  links: Link[]
  selectedSection: string | null
  onSelectSection: (slug: string | null) => void
  onNavigate: (url: string) => void
}) {
  const { theme } = useTheme()
  return (
    <box gap={1} paddingTop={1} paddingBottom={1}>
      <Show when={props.headings.length > 0}>
        <box
          gap={0}
          backgroundColor={theme.backgroundElement}
          paddingLeft={1}
          paddingRight={1}
          paddingTop={1}
          paddingBottom={1}
        >
          <text fg={theme.secondary} attributes={TextAttributes.BOLD}>
            On This Page
          </text>
          <For each={props.headings.slice(0, 16)}>
            {(h) => {
              const indent = Math.max(0, h.level - 1)
              const maxLen = 26 - indent
              const label = h.text.length > maxLen ? h.text.slice(0, maxLen - 2) + ".." : h.text
              return (
                <box paddingLeft={indent} onMouseUp={() => props.onSelectSection(h.slug)}>
                  <text fg={props.selectedSection === h.slug ? theme.primary : theme.text}>{label}</text>
                </box>
              )
            }}
          </For>
          <Show when={props.selectedSection}>
            <text fg={theme.primary} onMouseUp={() => props.onSelectSection(null)}>
              show full page
            </text>
          </Show>
        </box>
      </Show>
      <Show when={props.links.length > 0}>
        <box
          gap={0}
          backgroundColor={theme.backgroundElement}
          paddingLeft={1}
          paddingRight={1}
          paddingTop={1}
          paddingBottom={1}
        >
          <text fg={theme.secondary} attributes={TextAttributes.BOLD}>
            Links
          </text>
          <For each={props.links.slice(0, 10)}>
            {(link) => {
              const label = link.text.length > 26 ? link.text.slice(0, 24) + ".." : link.text
              return (
                <text fg={theme.primary} wrapMode="char" onMouseUp={() => props.onNavigate(link.href)}>
                  {label}
                </text>
              )
            }}
          </For>
        </box>
      </Show>
    </box>
  )
}
