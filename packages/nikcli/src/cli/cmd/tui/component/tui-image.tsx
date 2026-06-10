import { createEffect, createMemo, createSignal, For, Match, onCleanup, Show, Switch } from "solid-js"
import { RGBA } from "@opentui/core"
import { detectCapabilities, encodeHalfblock, renderImage, type RendererKind } from "@nikcli-ai/tui-image"
import { useTheme } from "@tui/context/theme"

/**
 * New image preview component built on top of `@nikcli-ai/tui-image`.
 *
 * Compared to the legacy `image-preview.tsx` (which renders Unicode Braille
 * glyphs only), this component:
 *
 *  1. Inspects the connected terminal at runtime and picks the best
 *     renderer — Kitty Graphics, Sixel, iTerm2, or the half-block fallback.
 *  2. When the terminal supports a native protocol, writes the encoded
 *     bytes directly to `stdout` via `process.stdout.write` because the
 *     `OpenTUI` renderer is currently incapable of painting the embedded
 *     escape sequences inside its own grid.
 *  3. Falls back to the half-block renderer for any other terminal.
 *
 * The file is intentionally self-contained: the legacy `image-preview.tsx`
 * still works, but new call-sites should import `TuiImage` from here.
 */
const MAX_PREVIEW_BYTES = 10 * 1024 * 1024
const MAX_PREVIEW_COLUMNS = 60
const MAX_PREVIEW_HALFBLOCK_ROWS = 24
const IMAGE_EXTENSIONS = /\.(?:png|jpe?g|gif|webp|bmp|tiff?)(?:$|[?#])/i
const GITHUB_ATTACHMENT = new RegExp("^https://github\\.com/user-attachments/assets/", "i")
const TRANSPARENT = RGBA.fromInts(0, 0, 0, 0)

function cleanPreviewUrl(value: string) {
  return value
    .trim()
    .replace(/^<|>$/g, "")
    .replace(/[),.;:!?]+$/, "")
}

function hostForUrl(value: string) {
  if (value.startsWith("data:image/")) return "attached image"
  if (value.startsWith("/")) return "local file"
  try {
    const url = new URL(value)
    if (url.protocol === "file:") return "local file"
    return url.hostname.replace(/^www\./, "") || value
  } catch {
    return value
  }
}

function isSupportedSource(value: string) {
  if (value.startsWith("data:image/")) return true
  if (value.startsWith("/")) return true
  try {
    const url = new URL(value)
    return url.protocol === "http:" || url.protocol === "https:" || url.protocol === "file:"
  } catch {
    return false
  }
}

function isImageCandidate(value: string, explicit: boolean) {
  if (!isSupportedSource(value)) return false
  if (explicit) return true
  if (IMAGE_EXTENSIONS.test(value)) return true
  return GITHUB_ATTACHMENT.test(value)
}

export function extractTuiImageUrls(text: string, limit = 2) {
  const urls: string[] = []
  const seen = new Set<string>()
  const add = (value: string, explicit: boolean) => {
    const url = cleanPreviewUrl(value)
    if (!url || seen.has(url)) return
    if (!isImageCandidate(url, explicit)) return
    seen.add(url)
    urls.push(url)
  }

  for (const match of text.matchAll(/!\[[^\]]*\]\((?:<([^>]+)>|([^)]+?))(?:\s+["'][^"']*["'])?\)/g)) {
    add(match[1] ?? match[2] ?? "", true)
    if (urls.length >= limit) return urls
  }
  for (const match of text.matchAll(/(?:https?:\/\/|file:\/\/)[^\s<>()\]]+/g)) {
    add(match[0], false)
    if (urls.length >= limit) return urls
  }
  for (const match of text.matchAll(/["'](\/[^"']+\.(?:png|jpe?g|gif|webp|bmp|tiff?))["']/gi)) {
    add(match[1] ?? "", false)
    if (urls.length >= limit) return urls
  }
  for (const match of text.matchAll(/(?:^|\s)(\/[\w~./%+-]+\.(?:png|jpe?g|gif|webp|bmp|tiff?))(?:$|\s)/gi)) {
    add(match[1] ?? "", false)
    if (urls.length >= limit) return urls
  }
  return urls
}

async function readImageBytes(url: string, signal: AbortSignal) {
  if (url.startsWith("data:")) {
    const match = url.match(/^data:([^;,]+)?((?:;[^,]*)?),(.*)$/s)
    if (!match) throw new Error("invalid data URL")
    const mime = match[1]?.toLowerCase()
    if (mime && !mime.startsWith("image/")) throw new Error("data URL is not an image")
    const metadata = match[2] ?? ""
    const payload = match[3] ?? ""
    const bytes = metadata.includes(";base64")
      ? Uint8Array.fromBase64(payload)
      : new TextEncoder().encode(decodeURIComponent(payload))
    if (bytes.byteLength > MAX_PREVIEW_BYTES) throw new Error("image is too large")
    return bytes
  }

  if (url.startsWith("/") || url.startsWith("file://")) {
    const filename = url.startsWith("file://") ? new URL(url).pathname : url
    const file = Bun.file(decodeURIComponent(filename))
    if (!(await file.exists())) throw new Error("image not found")
    if (file.size > MAX_PREVIEW_BYTES) throw new Error("image is too large")
    return new Uint8Array(await file.arrayBuffer())
  }

  const response = await fetch(url, {
    signal,
    headers: {
      Accept: "image/png,image/jpeg,image/gif,image/bmp,image/tiff,image/*;q=0.5,*/*;q=0.1",
    },
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)

  const contentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase()
  if (contentType && !contentType.startsWith("image/")) throw new Error("URL is not an image")

  const contentLength = Number(response.headers.get("content-length") ?? 0)
  if (contentLength > MAX_PREVIEW_BYTES) throw new Error("image is too large")

  const buffer = await response.arrayBuffer()
  if (buffer.byteLength > MAX_PREVIEW_BYTES) throw new Error("image is too large")
  return new Uint8Array(buffer)
}

type Cell = { char: string; fg: RGBA; bg: RGBA }

type TuiImageData = {
  url: string
  host: string
  width: number
  height: number
  columns: number
  rows: Cell[][]
  /** Raw bytes the caller can write to stdout when a native protocol is used. */
  nativeBytes?: Uint8Array | string
  renderer: RendererKind
}

export interface TuiImageWriter {
  (bytes: string | Uint8Array): void
}

/**
 * Default writer — writes to `process.stdout`. OpenTUI's `CliRenderer`
 * exposes a private `writeOut` hook on the FFI `RenderLib`; we use the
 * process-level writer here so the component can be unit-tested without a
 * live renderer.
 */
const defaultWriter: TuiImageWriter = (bytes) => {
  if (typeof process === "undefined" || !process.stdout) return
  try {
    if (typeof bytes === "string") {
      process.stdout.write(bytes)
    } else {
      process.stdout.write(Buffer.from(bytes))
    }
  } catch {
    // non-fatal
  }
}

type TuiImageState =
  | { status: "loading" }
  | { status: "ready"; data: TuiImageData }
  | { status: "error"; message: string }

const previewCache = new Map<string, Promise<TuiImageData>>()

function previewBounds(maxColumns: number, maxRows: number) {
  return {
    columns: Math.max(1, Math.min(MAX_PREVIEW_COLUMNS, maxColumns)),
    rows: Math.max(1, Math.min(MAX_PREVIEW_HALFBLOCK_ROWS, maxRows)),
  }
}

function applySgr(sequence: string, current: { fg: RGBA; bg: RGBA }) {
  const codes = sequence.length > 0 ? sequence.split(";").map((part) => Number(part || 0)) : [0]
  let fg = current.fg
  let bg = current.bg
  for (let index = 0; index < codes.length; index++) {
    const code = codes[index] ?? 0
    if (code === 0) {
      fg = TRANSPARENT
      bg = TRANSPARENT
      continue
    }
    if ((code === 38 || code === 48) && codes[index + 1] === 2) {
      const color = RGBA.fromInts(codes[index + 2] ?? 0, codes[index + 3] ?? 0, codes[index + 4] ?? 0, 255)
      if (code === 38) fg = color
      else bg = color
      index += 4
    }
  }
  return { fg, bg }
}

function toCellGrid(text: string, columns: number): Cell[][] {
  const rows = text.split("\n")
  const out: Cell[][] = []
  for (const line of rows) {
    const cells: Cell[] = []
    let fg = TRANSPARENT
    let bg = TRANSPARENT
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]!
      if (ch === "\x1b") {
        const start = line[i + 1] === "[" ? i + 2 : i + 1
        const end = line.indexOf("m", start)
        if (end === -1) break
        const next = applySgr(line.slice(start, end), { fg, bg })
        fg = next.fg
        bg = next.bg
        i = end
        continue
      }
      cells.push({ char: ch, fg, bg })
    }
    while (cells.length < columns) cells.push({ char: " ", fg: TRANSPARENT, bg: TRANSPARENT })
    if (cells.length > columns) cells.length = columns
    out.push(cells)
  }
  return out
}

async function loadTuiImage(
  url: string,
  maxColumns: number,
  maxRows: number,
  signal: AbortSignal,
): Promise<TuiImageData> {
  const bytes = await readImageBytes(url, signal)
  if (signal.aborted) throw new Error("aborted")
  const capabilities = detectCapabilities()
  const bounds = previewBounds(maxColumns, maxRows)
  const result = await renderImage({
    input: bytes,
    columns: bounds.columns,
    rows: bounds.rows,
    capabilities,
  })
  // For native protocols we don't try to map the encoded bytes back into
  // OpenTUI's grid (it doesn't yet model the image protocol); we just
  // expose them so the component can write them directly to stdout.
  if (result.renderer === "halfblock") {
    const halfblock = result.output as string
    return {
      url,
      host: hostForUrl(url),
      width: 0,
      height: 0,
      columns: result.columns,
      rows: toCellGrid(halfblock, result.columns),
      renderer: "halfblock",
    }
  }
  return {
    url,
    host: hostForUrl(url),
    width: 0,
    height: 0,
    columns: result.columns,
    rows: [],
    nativeBytes: result.output,
    renderer: result.renderer,
  }
}

function cachedTuiImage(url: string, maxColumns: number, maxRows: number, signal: AbortSignal) {
  const bounds = previewBounds(maxColumns, maxRows)
  const key = `${bounds.columns}x${bounds.rows}\n${url}`
  const cached = previewCache.get(key)
  if (cached) return cached
  const promise = loadTuiImage(url, bounds.columns, bounds.rows, signal).catch((error) => {
    previewCache.delete(key)
    throw error
  })
  previewCache.set(key, promise)
  return promise
}

function TuiImage(props: { url: string; maxColumns: number; maxRows: number; writer?: TuiImageWriter }) {
  const { theme } = useTheme()
  const [state, setState] = createSignal<TuiImageState>({ status: "loading" })

  createEffect(() => {
    const controller = new AbortController()
    const url = props.url
    setState({ status: "loading" })
    void cachedTuiImage(url, props.maxColumns, props.maxRows, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) {
          setState({ status: "ready", data })
          // For native protocols the bytes are written to stdout once, then
          // the component renders an empty placeholder so the rest of the
          // layout stays sane.
          if (data.nativeBytes !== undefined) {
            const writer = props.writer ?? defaultWriter
            writer(data.nativeBytes)
          }
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setState({
          status: "error",
          message: error instanceof Error ? error.message : String(error),
        })
      })
    onCleanup(() => controller.abort())
  })

  return (
    <box
      marginTop={1}
      paddingLeft={1}
      border={["left"]}
      borderColor={theme.border}
      flexDirection="column"
      flexShrink={0}
    >
      <Switch>
        <Match when={state().status === "loading"}>
          <text fg={theme.textMuted}>Loading image preview...</text>
        </Match>
        <Match when={state().status === "error" ? (state() as { status: "error"; message: string }) : undefined}>
          {(error) => <text fg={theme.textMuted}>Image preview unavailable: {error().message}</text>}
        </Match>
        <Match
          when={state().status === "ready" ? (state() as { status: "ready"; data: TuiImageData }).data : undefined}
        >
          {(data) => (
            <>
              <text fg={theme.textMuted}>
                image | {data().host} | {data().renderer}
                {data().renderer === "kitty" || data().renderer === "sixel" || data().renderer === "iterm2"
                  ? " (native)"
                  : ""}
              </text>
              <Show when={data().renderer === "halfblock" && data().rows.length > 0}>
                <box marginTop={1} flexDirection="column" flexShrink={0}>
                  <For each={data().rows}>
                    {(row) => (
                      <text>
                        <For each={row}>{(cell) => <span style={{ fg: cell.fg, bg: cell.bg }}>{cell.char}</span>}</For>
                      </text>
                    )}
                  </For>
                </box>
              </Show>
            </>
          )}
        </Match>
      </Switch>
    </box>
  )
}

export function TuiImageList(props: {
  text?: string
  urls?: string[]
  maxColumns: number
  maxRows: number
  limit?: number
  writer?: TuiImageWriter
}) {
  const urls = createMemo(() => {
    const limit = props.limit ?? 2
    const seen = new Set<string>()
    const result: string[] = []
    const add = (value: string, explicit: boolean) => {
      const url = cleanPreviewUrl(value)
      if (!url || seen.has(url)) return
      if (!isImageCandidate(url, explicit)) return
      seen.add(url)
      result.push(url)
    }
    for (const url of props.urls ?? []) {
      add(url, true)
      if (result.length >= limit) return result
    }
    for (const url of extractTuiImageUrls(props.text ?? "", limit)) {
      add(url, false)
      if (result.length >= limit) return result
    }
    return result
  })

  return (
    <Show when={urls().length > 0}>
      <box flexDirection="column" flexShrink={0}>
        <For each={urls()}>
          {(url) => <TuiImage url={url} maxColumns={props.maxColumns} maxRows={props.maxRows} writer={props.writer} />}
        </For>
      </box>
    </Show>
  )
}

// Re-export the encoders so existing call-sites can use them directly without
// importing from the package root.
export { encodeHalfblock }
