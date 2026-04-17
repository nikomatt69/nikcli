import { TextAttributes, TextareaRenderable } from "@opentui/core"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { createEffect, createMemo, createSignal, onCleanup, onMount, Show } from "solid-js"
import TurndownService from "turndown"
import { createTerminalBrowserSession, normalizeWebUrl, type TerminalBrowserSession } from "@nikcli-ai/terminal-browser"
import type { TerminalBrowserSnapshot } from "@nikcli-ai/terminal-browser"
import {
  createOpentuiBrowserController,
  TerminalBrowserRenderable,
  type TerminalBrowserController,
} from "@nikcli-ai/terminal-browser/solid"
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
}

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

function hostLabel(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return url
  }
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

  if (ct.includes("markdown")) {
    const md = normalizeMarkdown(raw)
    return {
      loading: false,
      error: null,
      url: finalUrl,
      title: hostLabel(finalUrl),
      description: "",
      markdown: md,
    }
  }

  if (!ct.includes("html") && !raw.includes("<html") && !raw.includes("<body")) {
    const fenced = ct.includes("json") ? `\`\`\`json\n${raw.trim()}\n\`\`\`` : raw.trim()
    return {
      loading: false,
      error: null,
      url: finalUrl,
      title: hostLabel(finalUrl),
      description: ct,
      markdown: normalizeMarkdown(fenced),
    }
  }

  const cleaned = stripNoise(raw)
  const contentHtml = extractContentRoot(cleaned)
  const md = normalizeMarkdown(turndown.turndown(contentHtml || cleaned))

  return {
    loading: false,
    error: null,
    url: finalUrl,
    title: extractTitle(raw) || hostLabel(finalUrl),
    description: extractDescription(raw),
    markdown: md || "_No readable content extracted from this page._",
  }
}

export type DialogWebPreviewProps = { url?: string }

export function DialogWebPreview(props: DialogWebPreviewProps) {
  const [fallbackReason, setFallbackReason] = createSignal<string | null>(null)
  const initialUrl = props.url ? normalizeWebUrl(props.url) : ""

  return (
    <Show
      when={!fallbackReason()}
      fallback={<DialogWebPreviewFallback url={initialUrl} initialError={fallbackReason() ?? undefined} />}
    >
      <DialogWebPreviewBrowser url={initialUrl} onFallback={(reason) => setFallbackReason(reason)} />
    </Show>
  )
}

function DialogWebPreviewBrowser(props: { url?: string; onFallback: (reason: string) => void }) {
  const dialog = useDialog()
  const { theme } = useTheme()
  const dimensions = useTerminalDimensions()
  const initialUrl = props.url ? normalizeWebUrl(props.url) : ""

  const [address, setAddress] = createSignal(initialUrl)
  const [focusArea, setFocusArea] = createSignal<FocusArea>(initialUrl ? "content" : "url")
  const [session, setSession] = createSignal<TerminalBrowserSession | null>(null)
  const [controller, setController] = createSignal<TerminalBrowserController | null>(null)
  const [status, setStatus] = createSignal<TerminalBrowserSnapshot | null>(null)

  const contentHeight = createMemo(() => {
    const h = dimensions().height
    return Math.max(12, Math.min(h - 14, Math.floor(h * 0.6)))
  })
  const innerHeight = createMemo(() => Math.max(6, contentHeight() - 2))
  const browserColumns = createMemo(() => Math.max(20, dimensions().width - 10))

  let urlTextarea: TextareaRenderable | undefined
  let cleanup: (() => void) | undefined

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
    const normalized = normalizeWebUrl(rawUrl)
    if (!normalized) return
    setAddress(normalized)
    focusContent()
    await session()?.goto(normalized)
  }

  async function initBrowser() {
    try {
      const nextSession = await createTerminalBrowserSession({
        initialUrl: initialUrl || undefined,
        viewport: { columns: browserColumns(), rows: innerHeight() },
      })
      const nextController = createOpentuiBrowserController(nextSession)
      cleanup = nextSession.subscribe((snapshot) => {
        setStatus(snapshot)
        if (snapshot.url) setAddress(snapshot.url)
      })
      setSession(nextSession)
      setController(nextController)
      setStatus(nextSession.getSnapshot())

      if (!initialUrl) {
        focusUrlBar()
      }
    } catch (error) {
      props.onFallback(error instanceof Error ? error.message : String(error))
    }
  }

  onMount(() => {
    dialog.setSize("xlarge")
    void initBrowser()
  })

  onCleanup(() => {
    cleanup?.()
    void session()?.dispose()
  })

  createEffect(() => {
    if (!controller()) return
    void controller()!.setViewport({ columns: browserColumns(), rows: innerHeight() })
  })

  useKeyboard((evt) => {
    if (focusArea() === "url") return

    if (!evt.ctrl && !evt.meta && !evt.shift && evt.name === "r") {
      void session()?.reload()
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
      void session()?.back()
      evt.preventDefault()
      evt.stopPropagation()
      return
    }
    if ((evt.meta || evt.option) && evt.name === "right") {
      void session()?.forward()
      evt.preventDefault()
      evt.stopPropagation()
    }
  })

  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between" flexShrink={0}>
        <text fg={theme.primary} attributes={TextAttributes.BOLD}>
          ⊕ Terminal Browser
        </text>
        <text fg={theme.textMuted}>esc</text>
      </box>

      <box flexDirection="row" gap={1} alignItems="center" flexShrink={0}>
        <text
          fg={status()?.canGoBack ? theme.text : theme.textMuted}
          onMouseUp={() => void session()?.back()}
          flexShrink={0}
        >
          ←
        </text>
        <text
          fg={status()?.canGoForward ? theme.text : theme.textMuted}
          onMouseUp={() => void session()?.forward()}
          flexShrink={0}
        >
          →
        </text>
        <text fg={status()?.url ? theme.text : theme.textMuted} onMouseUp={() => void session()?.reload()} flexShrink={0}>
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
              const value = urlTextarea?.plainText.trim() ?? ""
              urlTextarea?.blur()
              if (!value) {
                focusContent()
                return
              }
              void navigate(value)
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
            const value = focusArea() === "url" ? (urlTextarea?.plainText.trim() ?? address()) : address()
            if (value) void navigate(value)
          }}
        >
          <text fg={theme.background}>Go</text>
        </box>
      </box>

      <box flexDirection="row" justifyContent="space-between" flexShrink={0}>
        <text fg={status()?.title ? theme.text : theme.textMuted} attributes={TextAttributes.BOLD} wrapMode="char">
          {status()?.title || (status()?.loading ? "Loading..." : "Starting Chromium...")}
        </text>
        <text fg={status()?.loading ? theme.primary : status()?.error ? theme.error : theme.textMuted}>
          {status()?.loading ? "loading" : status()?.error ? "error" : status() ? "ready" : "starting"}
        </text>
      </box>

      <Show when={status()?.error}>
        <box flexShrink={0}>
          <text fg={theme.error}>✗ {status()!.error}</text>
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
        <box paddingLeft={1} paddingRight={1} paddingTop={1} paddingBottom={1} height={innerHeight()}>
          <Show
            when={controller()}
            fallback={
              <text fg={theme.textMuted} wrapMode="word">
                Launching Chromium and attaching the terminal renderer...
              </text>
            }
          >
            <TerminalBrowserRenderable
              controller={controller()!}
              focused={focusArea() === "content"}
              width={browserColumns()}
              height={innerHeight()}
              backgroundColor={theme.background}
              onActivate={() => focusContent()}
            />
          </Show>
        </box>
      </box>

      <box flexDirection="row" justifyContent="space-between" flexShrink={0}>
        <text fg={theme.textMuted} wrapMode="char">
          {status()?.url || address() || ""}
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

function DialogWebPreviewFallback(props: { url?: string; initialError?: string }) {
  const dialog = useDialog()
  const { theme, syntax } = useTheme()
  const dimensions = useTerminalDimensions()
  const initialUrl = props.url ? normalizeWebUrl(props.url) : ""

  const [address, setAddress] = createSignal(initialUrl)
  const [focusArea, setFocusArea] = createSignal<FocusArea>(initialUrl ? "content" : "url")
  const [historyStack, setHistoryStack] = createSignal<string[]>([])
  const [historyIndex, setHistoryIndex] = createSignal(-1)
  const [page, setPage] = createSignal<PageState>({
    loading: false,
    error: props.initialError ?? null,
    url: "",
    title: "",
    description: "",
    markdown: "",
  })

  const contentHeight = createMemo(() => {
    const h = dimensions().height
    return Math.max(12, Math.min(h - 14, Math.floor(h * 0.6)))
  })
  const innerHeight = createMemo(() => Math.max(6, contentHeight() - 2))
  const canGoBack = createMemo(() => historyIndex() > 0)
  const canGoForward = createMemo(() => historyIndex() < historyStack().length - 1)

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
    const url = normalizeWebUrl(rawUrl)
    if (!url) return
    setAddress(url)
    focusContent()

    const id = ++reqId
    abortCtrl?.abort()
    const abort = new AbortController()
    abortCtrl = abort

    setPage((state) => ({ ...state, loading: true, error: props.initialError ?? null, url }))

    try {
      const result = await fetchPage(url, abort.signal)
      if (id !== reqId) return
      setPage(result)
      if (result.url) setAddress(result.url)

      const base = historyStack().slice(0, historyIndex() + 1)
      setHistoryStack([...base, result.url])
      setHistoryIndex(base.length)
    } catch (error) {
      if (abort.signal.aborted || id !== reqId) return
      setPage((state) => ({
        ...state,
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      }))
    } finally {
      if (abortCtrl === abort) abortCtrl = undefined
    }
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
      const target = page().url || address()
      if (target) void navigate(target)
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
    if ((evt.meta || evt.option) && evt.name === "left" && canGoBack()) {
      const idx = historyIndex() - 1
      setHistoryIndex(idx)
      void navigate(historyStack()[idx]!)
      evt.preventDefault()
      evt.stopPropagation()
      return
    }
    if ((evt.meta || evt.option) && evt.name === "right" && canGoForward()) {
      const idx = historyIndex() + 1
      setHistoryIndex(idx)
      void navigate(historyStack()[idx]!)
      evt.preventDefault()
      evt.stopPropagation()
    }
  })

  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between" flexShrink={0}>
        <text fg={theme.warning} attributes={TextAttributes.BOLD}>
          ⊕ Web Preview Fallback
        </text>
        <text fg={theme.textMuted}>esc</text>
      </box>

      <Show when={props.initialError}>
        <text fg={theme.warning} wrapMode="word">
          Browser runtime unavailable: {props.initialError}
        </text>
      </Show>

      <box flexDirection="row" gap={1} alignItems="center" flexShrink={0}>
        <text fg={canGoBack() ? theme.text : theme.textMuted} onMouseUp={() => canGoBack() && void navigate(historyStack()[historyIndex() - 1]!)} flexShrink={0}>
          ←
        </text>
        <text fg={canGoForward() ? theme.text : theme.textMuted} onMouseUp={() => canGoForward() && void navigate(historyStack()[historyIndex() + 1]!)} flexShrink={0}>
          →
        </text>
        <text fg={page().url ? theme.text : theme.textMuted} onMouseUp={() => (page().url || address()) && void navigate(page().url || address())} flexShrink={0}>
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
            ref={(value: TextareaRenderable) => {
              urlTextarea = value
            }}
            initialValue={address()}
            height={1}
            flexGrow={1}
            keyBindings={[{ name: "return", action: "submit" }]}
            onSubmit={() => {
              const value = urlTextarea?.plainText.trim() ?? ""
              urlTextarea?.blur()
              if (!value) {
                focusContent()
                return
              }
              void navigate(value)
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
            const value = focusArea() === "url" ? (urlTextarea?.plainText.trim() ?? address()) : address()
            if (value) void navigate(value)
          }}
        >
          <text fg={theme.background}>Go</text>
        </box>
      </box>

      <box flexDirection="row" justifyContent="space-between" flexShrink={0}>
        <text fg={page().title ? theme.text : theme.textMuted} attributes={TextAttributes.BOLD} wrapMode="char">
          {page().title || (page().loading ? "Loading..." : "Markdown preview")}
        </text>
        <text fg={page().loading ? theme.primary : page().error ? theme.error : theme.textMuted}>
          {page().loading ? "loading" : page().error ? "error" : page().markdown ? "ready" : ""}
        </text>
      </box>

      <Show when={page().error}>
        <text fg={theme.error}>✗ {page().error}</text>
      </Show>

      <box
        border
        borderColor={focusArea() === "content" ? theme.primary : theme.border}
        focusedBorderColor={theme.primary}
        height={contentHeight()}
        flexShrink={0}
        onMouseUp={() => focusContent()}
      >
        <scrollbox height={innerHeight()} focused={focusArea() === "content"} paddingLeft={1} paddingRight={1}>
          <box gap={1} paddingTop={1} paddingBottom={1}>
            <Show when={page().description}>
              <text fg={theme.textMuted} wrapMode="word">
                {page().description}
              </text>
            </Show>
            <Show
              when={page().markdown}
              fallback={
                <text fg={page().loading ? theme.secondary : theme.textMuted} wrapMode="word">
                  {page().loading ? "Fetching and formatting page..." : "Enter a URL above to preview a website."}
                </text>
              }
            >
              <markdown
                content={page().markdown}
                syntaxStyle={syntax()}
                fg={theme.text}
                conceal={true}
                tableOptions={{
                  widthMode: "full",
                  wrapMode: "word",
                  cellPadding: dimensions().width < 84 ? 0 : 1,
                  borders: dimensions().width >= 84,
                  outerBorder: false,
                  borderColor: theme.borderSubtle,
                }}
              />
            </Show>
          </box>
        </scrollbox>
      </box>

      <box flexDirection="row" justifyContent="space-between" flexShrink={0}>
        <text fg={theme.textMuted} wrapMode="char">
          {page().url || address() || ""}
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
