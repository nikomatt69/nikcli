import { createEffect, createMemo, createSignal, For, Match, onCleanup, Show, Switch } from "solid-js"
import { BoxRenderable, type CliRenderer, RGBA } from "@opentui/core"
import { useRenderer } from "@opentui/solid"
import {
  applyLiveCapabilities,
  bestOverlayProtocol,
  detectCapabilities,
  encodeIterm2Bytes,
  encodeKittyVirtual,
  encodeSixel,
  kittyIdColor,
  kittyPlaceholderGrid,
  pickDecoder,
  Protocol,
  renderImage,
  resize,
  supportsKittyUnicodePlaceholders,
  type LiveCapabilities,
  type RendererKind,
} from "@nikcli-ai/tui-image"
import { useTheme } from "@tui/context/theme"
import { preparePhoton } from "@/image/photon"

/**
 * Image preview component built on top of `@nikcli-ai/tui-image`.
 *
 * Real pixel images, like pi: on terminals that composite Kitty Unicode
 * placeholders (kitty, Ghostty) the image is transmitted once as a virtual
 * placement (`a=T,U=1` — draws nothing at the cursor, safe inside the
 * alternate screen) and the component renders ordinary placeholder cells
 * (U+10EEEE + row/column diacritics, image id in the foreground color)
 * inside OpenTUI's grid. The terminal overlays the image wherever those
 * cells land, so scrolling and repaints just work.
 *
 * Terminals with iTerm2 or Sixel support receive a cursor-positioned overlay
 * during OpenTUI's native render pass. Every other terminal renders through
 * the grid with the truecolor ANSI half-block fallback.
 */
const MAX_PREVIEW_BYTES = 10 * 1024 * 1024
const MAX_PREVIEW_COLUMNS = 120
const MAX_PREVIEW_FALLBACK_ROWS = 36
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
  /**
   * Kitty virtual-placement transmission (`a=T,U=1,q=2…`). Drawless by
   * construction, so writing it to stdout is safe inside the TUI; written
   * once per cache entry (see `transmitted`).
   */
  nativeBytes?: Uint8Array | string
  /** Whether `nativeBytes` has already been written to the terminal. */
  transmitted?: boolean
  /** Placeholder cell rows the terminal composites the image over. */
  placeholder?: { rows: string[]; fg: RGBA }
  /** Cursor-positioned native image drawn after OpenTUI flushes its frame. */
  overlay?: { bytes: Uint8Array | string; columns: number; rows: number }
  renderer: RendererKind
}

export interface TuiImageWriter {
  (bytes: string | Uint8Array): void
}

/**
 * Default writer — writes to `process.stdout`. Only ever used for drawless
 * kitty transmissions; kept injectable so the component can be unit-tested
 * without a live renderer.
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

// Virtual-placement image ids are per terminal session; offsetting by pid
// keeps concurrent / successive nikcli processes from overwriting each
// other's images in the same terminal.
let placeholderIdCounter = 0
const placeholderIdBase = (((typeof process !== "undefined" ? process.pid : 0) ?? 0) & 0xff) << 16

function nextPlaceholderId() {
  placeholderIdCounter = (placeholderIdCounter % 0xffff) + 1
  return placeholderIdBase + placeholderIdCounter
}

type TuiImageState =
  | { status: "loading" }
  | { status: "ready"; data: TuiImageData }
  | { status: "error"; message: string }

const previewCache = new Map<string, Promise<TuiImageData>>()

type NativeOverlay = {
  box: BoxRenderable
  bytes: Uint8Array | string
  columns: number
  rows: number
}

/**
 * Subset of {@link CliRenderer} the overlay hook needs. `renderNative`,
 * `writeOut`, and `renderOffset` are declared `private` on the upstream
 * class, so we model them structurally here and cast at the boundary
 * instead of intersecting with `CliRenderer` (which TypeScript would
 * reduce to `never`).
 */
type OverlayRenderer = {
  requestRender: () => void
  terminalWidth: number
  terminalHeight: number
  renderNative: () => void
  writeOut: (chunk: string) => void
  renderOffset: number
}

const nativeOverlayManagers = new WeakMap<
  CliRenderer,
  {
    overlays: Set<NativeOverlay>
    originalRenderNative: () => void
  }
>()

function nativePayload(bytes: Uint8Array | string) {
  return typeof bytes === "string" ? bytes : Buffer.from(bytes).toString("ascii")
}

function registerNativeOverlay(renderer: CliRenderer, overlay: NativeOverlay) {
  const target = renderer as unknown as OverlayRenderer
  let manager = nativeOverlayManagers.get(renderer)
  if (!manager) {
    const originalRenderNative = target.renderNative.bind(renderer)
    manager = { overlays: new Set(), originalRenderNative }
    nativeOverlayManagers.set(renderer, manager)
    target.renderNative = () => {
      originalRenderNative()
      for (const item of manager!.overlays) {
        const x = item.box.x
        const y = item.box.y + (target.renderOffset ?? 0)
        const right = x + item.columns
        const bottom = y + item.rows
        if (x < 0 || y < 0 || right > renderer.terminalWidth || bottom > renderer.terminalHeight) continue
        target.writeOut(`\x1b7\x1b[${y + 1};${x + 1}H${nativePayload(item.bytes)}\x1b8`)
      }
    }
  }
  manager.overlays.add(overlay)
  renderer.requestRender()
  return () => {
    const current = nativeOverlayManagers.get(renderer)
    if (!current) return
    current.overlays.delete(overlay)
    if (current.overlays.size > 0) {
      renderer.requestRender()
      return
    }
    target.renderNative = current.originalRenderNative
    nativeOverlayManagers.delete(renderer)
    renderer.requestRender()
  }
}

function previewBounds(maxColumns: number, maxRows: number) {
  return {
    columns: Math.max(1, Math.min(MAX_PREVIEW_COLUMNS, maxColumns)),
    rows: Math.max(1, Math.min(MAX_PREVIEW_FALLBACK_ROWS, maxRows)),
  }
}

function fitNativeCells(width: number, height: number, bounds: { columns: number; rows: number }) {
  const aspect = width / height
  let columns = bounds.columns
  let rows = Math.max(1, Math.round(columns / (aspect * 2)))
  if (rows > bounds.rows) {
    rows = bounds.rows
    columns = Math.max(1, Math.min(bounds.columns, Math.round(rows * aspect * 2)))
  }
  return { columns, rows }
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

/** Approximate pixels per cell used to bound the transmitted image size. */
const CELL_PIXEL_WIDTH = 10
const CELL_PIXEL_HEIGHT = 20

async function loadTuiImage(
  url: string,
  maxColumns: number,
  maxRows: number,
  live: LiveCapabilities | null,
  signal: AbortSignal,
): Promise<TuiImageData> {
  const bytes = await readImageBytes(url, signal)
  if (signal.aborted) throw new Error("aborted")
  // Point photon at its embedded wasm before any decoder can reach for it:
  // it is the only backend here that reads WebP.
  preparePhoton()
  // Env detection over-reports native protocols (TERM=xterm-256color implies
  // sixel almost everywhere); the renderer's negotiated DA1 answer decides.
  const capabilities = applyLiveCapabilities(detectCapabilities(), live)
  const bounds = previewBounds(maxColumns, maxRows)

  if (supportsKittyUnicodePlaceholders(capabilities)) {
    const decoder = await pickDecoder()
    const image = await decoder(bytes)
    if (image.width <= 0 || image.height <= 0) throw new Error("decoder produced a zero-sized image")
    // A terminal cell is roughly twice as tall as it is wide; pick the cell
    // rectangle that matches the image aspect within the preview bounds.
    const { columns, rows } = fitNativeCells(image.width, image.height, bounds)
    // The terminal scales the image into the placeholder rectangle, so the
    // transmission only needs preview-grade pixels.
    const maxWidth = columns * CELL_PIXEL_WIDTH
    const maxHeight = rows * CELL_PIXEL_HEIGHT
    const scale = Math.min(maxWidth / image.width, maxHeight / image.height, 1)
    const target =
      scale < 1
        ? resize(image, Math.max(1, Math.round(image.width * scale)), Math.max(1, Math.round(image.height * scale)))
        : image
    const id = nextPlaceholderId()
    const color = kittyIdColor(id)
    return {
      url,
      host: hostForUrl(url),
      width: image.width,
      height: image.height,
      columns,
      rows: [],
      nativeBytes: encodeKittyVirtual(target, { id, columns, rows }),
      placeholder: {
        rows: kittyPlaceholderGrid(columns, rows),
        fg: RGBA.fromInts(color.r, color.g, color.b, 255),
      },
      renderer: "kitty",
    }
  }

  const overlayProtocol = bestOverlayProtocol(capabilities)
  if (overlayProtocol) {
    const decoder = await pickDecoder()
    const image = await decoder(bytes)
    if (image.width <= 0 || image.height <= 0) throw new Error("decoder produced a zero-sized image")
    const { columns, rows } = fitNativeCells(image.width, image.height, bounds)
    const output =
      overlayProtocol === Protocol.ITERM2
        ? encodeIterm2Bytes(bytes, {
            width: columns,
            height: rows,
            preserveAspectRatio: true,
          })
        : encodeSixel(resize(image, columns * CELL_PIXEL_WIDTH, rows * CELL_PIXEL_HEIGHT))
    return {
      url,
      host: hostForUrl(url),
      width: image.width,
      height: image.height,
      columns,
      rows: [],
      overlay: { bytes: output, columns, rows },
      renderer: overlayProtocol === Protocol.ITERM2 ? "iterm2" : "sixel",
    }
  }

  // Every other terminal renders through OpenTUI's grid. Cursor-addressed
  // protocols (classic kitty, iTerm2, Sixel) are deliberately not used here:
  // inside the alternate screen their output lands at the wrong position and
  // is clobbered by the next frame.
  const result = await renderImage({
    input: bytes,
    columns: bounds.columns,
    rows: bounds.rows,
    capabilities,
    renderer: "halfblock",
  })
  const fallback = result.output as string
  return {
    url,
    host: hostForUrl(url),
    width: 0,
    height: 0,
    columns: result.columns,
    rows: toCellGrid(fallback, result.columns),
    renderer: "halfblock",
  }
}

function cachedTuiImage(
  url: string,
  maxColumns: number,
  maxRows: number,
  live: LiveCapabilities | null,
  signal: AbortSignal,
) {
  const bounds = previewBounds(maxColumns, maxRows)
  // Negotiated capabilities arrive shortly after renderer startup; keying on
  // them keeps an early env-only result from pinning the protocol choice.
  const key = `${bounds.columns}x${bounds.rows}\n${live ? "live" : "env"}\n${url}`
  const cached = previewCache.get(key)
  if (cached) return cached
  const promise = loadTuiImage(url, bounds.columns, bounds.rows, live, signal).catch((error) => {
    previewCache.delete(key)
    throw error
  })
  previewCache.set(key, promise)
  return promise
}

function TuiImage(props: { url: string; maxColumns: number; maxRows: number; writer?: TuiImageWriter }) {
  const { theme } = useTheme()
  const renderer = useRenderer()
  const [state, setState] = createSignal<TuiImageState>({ status: "loading" })
  const [overlayBox, setOverlayBox] = createSignal<BoxRenderable>()

  createEffect(() => {
    const controller = new AbortController()
    const url = props.url
    setState({ status: "loading" })
    const live = (renderer.capabilities ?? null) as LiveCapabilities | null
    void cachedTuiImage(url, props.maxColumns, props.maxRows, live, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) {
          // The kitty transmission is drawless (a=T,U=1) — written once per
          // cache entry, no matter how many times the component remounts.
          if (data.nativeBytes !== undefined && !data.transmitted) {
            data.transmitted = true
            const writer = props.writer ?? defaultWriter
            writer(data.nativeBytes)
          }
          setState({ status: "ready", data })
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

  createEffect(() => {
    const current = state()
    const box = overlayBox()
    if (current.status !== "ready" || !current.data.overlay || !box) return
    const unregister = registerNativeOverlay(renderer, {
      box,
      bytes: current.data.overlay.bytes,
      columns: current.data.overlay.columns,
      rows: current.data.overlay.rows,
    })
    onCleanup(unregister)
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
                {data().placeholder ? " (native)" : ""}
              </text>
              <Show when={data().placeholder}>
                {(placeholder) => (
                  <box marginTop={1} flexDirection="column" flexShrink={0}>
                    <For each={placeholder().rows}>{(row) => <text fg={placeholder().fg}>{row}</text>}</For>
                  </box>
                )}
              </Show>
              <Show when={data().overlay}>
                <box
                  ref={(box: BoxRenderable) => setOverlayBox(box)}
                  marginTop={1}
                  width={data().overlay!.columns}
                  height={data().overlay!.rows}
                  flexShrink={0}
                />
              </Show>
              <Show when={data().rows.length > 0}>
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
