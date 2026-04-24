import { createEffect, createMemo, createSignal, For, Match, onCleanup, Show, Switch } from "solid-js"
import { RGBA } from "@opentui/core"
import { useTheme } from "@tui/context/theme"

const MAX_PREVIEW_BYTES = 10 * 1024 * 1024
const MAX_PREVIEW_COLUMNS = 180
const MAX_PREVIEW_BRAILLE_ROWS = 40
const MIN_PREVIEW_COLUMNS = 24
const IMAGE_EXTENSIONS = /\.(?:png|jpe?g|gif|webp|bmp|tiff?)(?:$|[?#])/i
const GITHUB_ATTACHMENT = /^https:\/\/github\.com\/user-attachments\/assets\//i

type ImagePreviewCell = {
  fg: RGBA
  bg: RGBA
}

type ImagePreviewData = {
  url: string
  host: string
  width: number
  height: number
  columns: number
  rows: ImagePreviewCell[][]
}

type ImagePreviewState =
  | { status: "loading" }
  | { status: "ready"; data: ImagePreviewData }
  | { status: "error"; message: string }

const previewCache = new Map<string, Promise<ImagePreviewData>>()

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

export function extractImagePreviewUrls(text: string, limit = 2) {
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

function colorAt(data: Uint8Array, width: number, x: number, y: number) {
  const index = (y * width + x) * 4
  return RGBA.fromInts(data[index] ?? 0, data[index + 1] ?? 0, data[index + 2] ?? 0, data[index + 3] ?? 255)
}

async function loadImagePreview(url: string, maxColumns: number, signal: AbortSignal): Promise<ImagePreviewData> {
  const bytes = await readImageBytes(url, signal)
  if (signal.aborted) throw new Error("aborted")

  const { Jimp } = await import("jimp")
  const image = await Jimp.read(Buffer.from(bytes))
  const sourceWidth = image.bitmap.width
  const sourceHeight = image.bitmap.height
  if (!sourceWidth || !sourceHeight) throw new Error("image has no pixels")

  // Resize to fill available width (min 24 cols), respecting aspect ratio
  const columns = Math.max(24, Math.min(maxColumns, sourceWidth))
  const targetHeight = Math.round((columns / sourceWidth) * sourceHeight)
  // Clamp to reasonable preview height (terminal cells, each showing 2px vertically)
  const maxPreviewRows = MAX_PREVIEW_BRAILLE_ROWS
  const targetPixelHeight = Math.max(2, Math.min(maxPreviewRows * 2, targetHeight))
  const pixelHeight = targetPixelHeight % 2 === 0 ? targetPixelHeight : targetPixelHeight + 1
  const cols = Math.min(columns, sourceWidth)

  image.resize({ w: cols, h: pixelHeight })

  const data = new Uint8Array(image.bitmap.data)
  const rows: ImagePreviewCell[][] = []
  for (let y = 0; y < pixelHeight; y += 2) {
    const row: ImagePreviewCell[] = []
    for (let x = 0; x < cols; x++) {
      row.push({
        fg: colorAt(data, cols, x, y),
        bg: colorAt(data, cols, x, Math.min(y + 1, pixelHeight - 1)),
      })
    }
    rows.push(row)
  }

  return {
    url,
    host: hostForUrl(url),
    width: sourceWidth,
    height: sourceHeight,
    columns: cols,
    rows,
  }
}

function cachedImagePreview(url: string, maxColumns: number, signal: AbortSignal) {
  const key = `${maxColumns}\n${url}`
  const cached = previewCache.get(key)
  if (cached) return cached
  const promise = loadImagePreview(url, maxColumns, signal).catch((error) => {
    previewCache.delete(key)
    throw error
  })
  previewCache.set(key, promise)
  return promise
}

function ImagePreview(props: { url: string; maxColumns: number }) {
  const { theme } = useTheme()
  const [state, setState] = createSignal<ImagePreviewState>({ status: "loading" })

  createEffect(() => {
    const controller = new AbortController()
    const url = props.url
    setState({ status: "loading" })
    void cachedImagePreview(url, props.maxColumns, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setState({ status: "ready", data })
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setState({ status: "error", message: error instanceof Error ? error.message : String(error) })
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
          when={state().status === "ready" ? (state() as { status: "ready"; data: ImagePreviewData }).data : undefined}
        >
          {(data) => (
            <>
              <text fg={theme.textMuted}>
                image | {data().host} | {data().width}x{data().height}
              </text>
              <box marginTop={1} flexDirection="column" flexShrink={0}>
                <For each={data().rows}>
                  {(row) => (
                    <text>
                      <For each={row}>{(cell) => <span style={{ fg: cell.fg, bg: cell.bg }}>▀</span>}</For>
                    </text>
                  )}
                </For>
              </box>
            </>
          )}
        </Match>
      </Switch>
    </box>
  )
}

export function ImagePreviewList(props: { text?: string; urls?: string[]; maxColumns: number; limit?: number }) {
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
    for (const url of extractImagePreviewUrls(props.text ?? "", limit)) {
      add(url, false)
      if (result.length >= limit) return result
    }
    return result
  })

  return (
    <Show when={urls().length > 0}>
      <box flexDirection="column" flexShrink={0}>
        <For each={urls()}>{(url) => <ImagePreview url={url} maxColumns={props.maxColumns} />}</For>
      </box>
    </Show>
  )
}
