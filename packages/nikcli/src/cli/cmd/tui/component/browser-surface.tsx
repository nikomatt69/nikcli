/**
 * BrowserSurface — a live Chromium page rendered into the OpenTUI grid.
 *
 * Chromium screencasts PNG frames to the browser-control daemon; the daemon
 * writes each one to a temp file and streams the path here; the pump turns
 * that into a Kitty virtual placement over the placeholder cells this
 * component renders. See `specs/browser-live-view.md` for why each hop exists.
 *
 * The component owns the session for its lifetime: it starts one on mount and
 * removes it on unmount, so closing the dialog never leaves a headless
 * Chromium running. Everything it needs from the daemon is imported lazily —
 * a TUI that never opens a browser must not pay for Playwright's presence in
 * the module graph (`specs/startup-performance.md`).
 */
import { RGBA } from "@opentui/core"
import type { BoxRenderable, MouseEvent } from "@opentui/core"
import { useRenderer } from "@opentui/solid"
import { createEffect, createSignal, For, Match, onCleanup, Show, Switch } from "solid-js"
import { encodeSixel, pickDecoder, resize } from "@nikcli-ai/tui-image"
import { BrowserFramePump, cellSize, type FrameTransmission, type PumpStats } from "@tui/util/browser-frames"
import { compose } from "@tui/feature-plugins/background/pixels"
import { preparePhoton } from "@/image/photon"
// `BackgroundRenderable` is only *named* for the background image: what it
// actually is, is "paint an RGBA super-sample buffer into the grid" — a
// `FrameBufferRenderable` handing the pixels to OpenTUI's native half-block
// sampler in one call. That is exactly what a browser frame needs on a
// terminal with no graphics protocol, and it is why the background photo
// renders in terminals where Kitty placeholders cannot.
import { BackgroundRenderable } from "@tui/feature-plugins/background/renderable"
import { registerNativeOverlay, type NativeOverlay } from "./tui-image"
import { useSync } from "@tui/context/sync"
import { useTheme } from "@tui/context/theme"

void BackgroundRenderable // keep the `extend()` registration in the module graph

export type BrowserSurfaceStatus = "starting" | "live" | "error"

/**
 * How the page's pixels get onto the screen.
 *
 * - `kitty` composites a real image over placeholder cells: full resolution,
 *   needs a terminal that implements the Kitty graphics protocol.
 * - `overlay` draws a real Sixel image over the grid, positioned after OpenTUI
 *   flushes its frame. Full resolution like `kitty`, but it costs a decode and
 *   a quantise per frame. This is what the VS Code / Cursor terminal can do,
 *   once `terminal.integrated.enableImages` is turned on.
 * - `halfblock` paints `▀` cells through the native super-sampler: two pixels
 *   per cell vertically, two horizontally, so a page is shapes and colour
 *   rather than readable text — but it needs nothing from the terminal at all.
 */
export type SurfaceRenderer = "kitty" | "overlay" | "halfblock"

export interface BrowserSurfaceState {
  readonly status: BrowserSurfaceStatus
  /** Where the page currently *is*, as the page itself reports it — redirects and all. */
  readonly url: string
  readonly title: string
  readonly error?: string
  /** False when the terminal never reported its pixel resolution and cell size is a guess. */
  readonly measured: boolean
  readonly transmission: FrameTransmission
  readonly stats: PumpStats
  /** Page pixels per half-block sample; 0 when the renderer is `kitty`. */
  readonly zoom: number
}

export interface BrowserSurfaceControls {
  goto(url: string): void
  back(): void
  forward(): void
  reload(): void
  /** Send a key press, or insert literal text, into the page. */
  key(input: { key?: string; text?: string }): void
  /** Flip `t=t` ↔ inline base64. The only usable diagnostic when nothing draws. */
  toggleTransmission(): void
  /** Half-block only: trade page area against sharpness. See {@link ZOOM_STEPS}. */
  zoom(direction: 1 | -1): void
}

/**
 * How many page pixels each half-block sample covers.
 *
 * The effective display is `columns × rows*2` — the sampler averages the two
 * horizontal samples of a cell into one value — so a factor of 4 lays the page
 * out four times wider than it can actually be shown, and the box average
 * throws the rest away.
 *
 * There is no correct value, only a trade: a lower factor is proportionally
 * sharper and shows proportionally less page. 1 is the default — one page
 * pixel per sample, nothing resampled away, so glyphs land exactly as the page
 * drew them and you scroll to read. Larger factors fit more layout on screen at
 * proportionally more blur.
 */
const ZOOM_STEPS = [1, 2, 3, 4, 5, 6] as const
const DEFAULT_ZOOM_INDEX = 0

export interface BrowserSurfaceProps {
  /** Where the page starts. Later navigation goes through {@link BrowserSurfaceControls.goto}, not this prop. */
  readonly initialUrl: string
  /** Placement size in terminal cells. */
  readonly columns: number
  readonly rows: number
  readonly focused: boolean
  readonly renderer: SurfaceRenderer
  readonly onState?: (state: BrowserSurfaceState) => void
  readonly ref?: (controls: BrowserSurfaceControls) => void
}

/**
 * How much of the sharpening pass to apply. 0 is the raw box average; much
 * above 1 and flat areas start ringing. Text on a page is almost entirely
 * high-frequency detail, which is exactly what a box average destroys, so this
 * sits deliberately on the strong side.
 */
const SHARPEN_AMOUNT = 0.9

/**
 * Unsharp mask, in place, on a composed RGBA buffer.
 *
 * Box averaging is the right way to *shrink* a picture — it is why the result
 * doesn't alias — but averaging is a low-pass filter, and a page shrunk five
 * times is mostly the frequencies it just threw away. Adding back the
 * difference between each pixel and its neighbourhood restores the edge
 * contrast that makes glyphs and borders readable, without reintroducing the
 * jaggies that point-sampling would have given.
 *
 * Runs over `columns × 2 · rows × 2` pixels — a few tens of thousands, once
 * per frame.
 */
function sharpen(buffer: Uint8Array, width: number, height: number, amount = SHARPEN_AMOUNT): Uint8Array {
  if (amount <= 0 || width < 3 || height < 3) return buffer
  const source = new Uint8Array(buffer)
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const centre = (y * width + x) * 4
      for (let channel = 0; channel < 3; channel++) {
        const i = centre + channel
        // 4-neighbour Laplacian: centre minus the mean of its neighbours.
        const neighbours =
          (source[i - 4] ?? 0) + (source[i + 4] ?? 0) + (source[i - width * 4] ?? 0) + (source[i + width * 4] ?? 0)
        const value = (source[i] ?? 0) + amount * ((source[i] ?? 0) - neighbours / 4)
        buffer[i] = value < 0 ? 0 : value > 255 ? 255 : Math.round(value)
      }
    }
  }
  return buffer
}

/** Session names are per surface instance: two dialogs must not fight over one page. */
function surfaceSessionName(): string {
  return `nikcli-preview-${process.pid}-${Math.floor(Math.random() * 0xffff).toString(16)}`
}

export function BrowserSurface(props: BrowserSurfaceProps) {
  const { theme } = useTheme()
  const renderer = useRenderer()
  const sync = useSync()

  const pump = new BrowserFramePump()
  const name = surfaceSessionName()

  const [placeholder, setPlaceholder] = createSignal<string[]>([])
  const [pixels, setPixels] = createSignal<Uint8Array | undefined>()
  const [status, setStatus] = createSignal<BrowserSurfaceStatus>("starting")
  const [error, setError] = createSignal<string | undefined>()
  const [pageUrl, setPageUrl] = createSignal(props.initialUrl)
  const [title, setTitle] = createSignal("")
  const [measured, setMeasured] = createSignal(true)
  const [transmission, setTransmission] = createSignal<FrameTransmission>(pump.mode)
  const [zoomIndex, setZoomIndex] = createSignal(DEFAULT_ZOOM_INDEX)
  const [overlayBytes, setOverlayBytes] = createSignal<Uint8Array | undefined>()
  const [overlayBox, setOverlayBox] = createSignal<BoxRenderable>()
  const [stats, setStats] = createSignal<PumpStats>(pump.stats)

  let socketPath: string | undefined
  let call: (<T>(method: string, params?: Record<string, unknown>) => Promise<T>) | undefined
  let streamAbort: AbortController | undefined
  let started = false
  let disposed = false
  let restartTimer: ReturnType<typeof setTimeout> | undefined
  let box: BoxRenderable | undefined
  let generation = 0
  let decoder: Awaited<ReturnType<typeof pickDecoder>> | undefined
  let decoding = false
  let nativeOverlay: NativeOverlay | undefined

  const emit = () =>
    props.onState?.({
      status: status(),
      url: pageUrl(),
      title: title(),
      error: error(),
      measured: measured(),
      transmission: transmission(),
      stats: stats(),
      zoom: props.renderer === "halfblock" ? (ZOOM_STEPS[zoomIndex()] ?? 0) : 0,
    })

  createEffect(emit)

  const fail = (cause: unknown) => {
    if (disposed) return
    setError(cause instanceof Error ? cause.message : String(cause))
    setStatus("error")
  }

  /**
   * The page viewport, in pixels. Capture is always the same size as the
   * viewport: the downscale has to happen in `compose`'s box-average
   * resampler, because anything Chromium throws away first can never be
   * averaged back. Same pipeline the background photo goes through, which is
   * why that one looks smooth.
   *
   * `kitty` gets one page pixel per screen pixel, from the terminal's own cell
   * size.
   *
   * `halfblock` sizes the viewport from the *sample grid* instead. The
   * destination is `columns × 2` by `rows × 2` samples, and the page is laid
   * out at 2× that horizontally and 4× vertically — `columns × 4` by
   * `rows × 8`. Two things fall out of that choice:
   *
   *  - the aspect is `columns : rows × 2`, exactly what `compose` fits
   *    against, so the `contain` fit letterboxes nothing;
   *  - the page lays out at roughly tablet width rather than desktop width, so
   *    text is physically larger *relative to the viewport* and survives the
   *    downscale. A desktop-width layout squeezed into the same cells loses
   *    around 5× horizontally and 10× vertically; this loses 2× and 4×.
   *
   * The vertical loss is always the worse of the two — a `▀` cell carries two
   * samples down and two across while being twice as tall as it is wide. That
   * is inherent to the technique, not a tuning choice.
   */
  const geometry = () => {
    const cell = cellSize(renderer.resolution, renderer.terminalWidth, renderer.terminalHeight)
    setMeasured(cell.measured)

    let size: { width: number; height: number }
    if (props.renderer === "halfblock") {
      const factor = ZOOM_STEPS[zoomIndex()] ?? 1
      const raw = { width: props.columns * factor, height: props.rows * factor * 2 }
      // Any floor has to scale *both* axes, or it would silently change the
      // aspect and `contain` would letterbox what it was meant to fill. At 1×
      // on a normal dialog this never triggers.
      const scale = Math.max(1, 64 / raw.width, 48 / raw.height)
      size = { width: Math.round(raw.width * scale), height: Math.round(raw.height * scale) }
    } else {
      size = {
        width: Math.max(64, Math.round(props.columns * cell.width)),
        height: Math.max(64, Math.round(props.rows * cell.height)),
      }
    }
    return { viewport: size, capture: size }
  }

  async function connect() {
    const { ensureDaemon, rpc, socketPathFor } = await import("@nikcli-ai/browser-control/daemon-client")
    const directory = sync.data.path.directory || process.cwd()
    socketPath = await socketPathFor(directory)
    await ensureDaemon(socketPath)
    call = <T,>(method: string, params?: Record<string, unknown>) => rpc<T>(socketPath!, method, params)
  }

  /**
   * (Re)open the frame stream. Called on mount and after a resize: the
   * screencast's pixel caps are fixed when it starts, so a placement that grew
   * needs a new stream rather than a scaled-up old one.
   */
  async function stream() {
    if (disposed || !socketPath) return
    const mine = ++generation
    streamAbort?.abort()
    const abort = new AbortController()
    streamAbort = abort

    const { openScreencast } = await import("@nikcli-ai/browser-control/daemon-client")
    const half = props.renderer === "halfblock"
    const overlay = props.renderer === "overlay"
    const { capture } = geometry()
    try {
      for await (const frame of openScreencast(socketPath, {
        name,
        // Half-block has to decode the picture to resample it, so it needs the
        // bytes in this process; `file` mode's whole point is *not* moving them.
        mode: half || overlay ? "inline" : pump.mode,
        maxWidth: capture.width,
        maxHeight: capture.height,
        // Overlay pays a decode *and* a sixel quantise per frame (~130ms for a
        // full-resolution page), so it asks for fewer of them.
        fps: half ? 8 : overlay ? 6 : 10,
        signal: abort.signal,
      })) {
        if (disposed || mine !== generation) break
        if (half) await paintHalfblock(frame.pngBase64)
        else if (overlay) await paintOverlay(frame.pngBase64)
        else pump.present(frame)
        setStats(pump.stats)
        if (status() !== "live") setStatus("live")
      }
    } catch (cause) {
      if (!abort.signal.aborted && mine === generation) fail(cause)
    }
  }

  /**
   * Encode a frame as Sixel and hand it to the overlay, which redraws it at the
   * box's position after every OpenTUI frame.
   *
   * The picture is resized to exactly the cell rectangle in pixels: a Sixel
   * lands at the cursor and covers however many cells its pixels span, so
   * getting this wrong makes it overflow the dialog rather than scale.
   */
  async function paintOverlay(pngBase64: string | undefined) {
    if (!pngBase64 || disposed || decoding) return
    decoding = true
    try {
      if (!decoder) {
        preparePhoton()
        decoder = await pickDecoder({ preferWasm: true })
      }
      const image = await decoder(Uint8Array.fromBase64(pngBase64))
      if (disposed || image.width <= 0 || image.height <= 0) return
      const cell = cellSize(renderer.resolution, renderer.terminalWidth, renderer.terminalHeight)
      const target = {
        width: Math.max(1, Math.round(props.columns * cell.width)),
        height: Math.max(1, Math.round(props.rows * cell.height)),
      }
      const scaled =
        image.width === target.width && image.height === target.height
          ? image
          : resize(image, target.width, target.height)
      const bytes = encodeSixel(scaled)
      if (disposed) return
      if (nativeOverlay) {
        nativeOverlay.bytes = bytes
        renderer.requestRender()
      } else {
        setOverlayBytes(bytes)
      }
    } catch {
      // One unencodable frame is not worth tearing the view down for.
    } finally {
      decoding = false
    }
  }

  /**
   * Decode a frame and hand it to the native super-sampler, the same way the
   * background image is painted. `compose` letterboxes against the grid's
   * physical shape and blends over the theme background, so the result is
   * always fully opaque and exactly the size the renderable expects.
   *
   * The decode is the one genuinely expensive step per frame, which is why it
   * runs on the wasm backend, caps the working image at the same size the
   * background does, and never has more than one frame in flight.
   */
  async function paintHalfblock(pngBase64: string | undefined) {
    if (!pngBase64 || disposed) return
    if (decoding) return // one frame in flight at a time; newer frames win by arriving later
    decoding = true
    try {
      if (!decoder) {
        // Point photon at its embedded wasm before the decoder reaches for it:
        // per-frame decoding is the one expensive step here, and the wasm
        // backend is the fast one.
        preparePhoton()
        decoder = await pickDecoder({ preferWasm: true })
      }
      const image = await decoder(Uint8Array.fromBase64(pngBase64))
      if (disposed || image.width <= 0 || image.height <= 0) return
      // Deliberately *not* `prepare()`-d first, unlike the background photo: a
      // photo is decoded once and resampled on every resize, so capping the
      // working copy pays for itself. Here the capture is already sized to the
      // grid, and the intermediate resample would just be a second pass of
      // blur between the page and the screen.
      const background = theme.background
      setPixels(
        sharpen(
          compose(image, {
            columns: props.columns,
            rows: props.rows,
            fit: "contain",
            opacity: 1,
            grayscale: false,
            base: {
              r: Math.round(background.r * 255),
              g: Math.round(background.g * 255),
              b: Math.round(background.b * 255),
            },
          }),
          props.columns * 2,
          props.rows * 2,
        ),
      )
    } catch {
      // A single undecodable frame is not worth tearing the view down for;
      // the next one arrives in ~100ms.
    } finally {
      decoding = false
    }
  }

  async function boot() {
    try {
      await connect()
      if (disposed) return
      await call!("start", { name, url: props.initialUrl, viewport: geometry().viewport })
      if (disposed) return
      started = true
      void refreshInfo()
      void stream()
    } catch (cause) {
      fail(cause)
    }
  }

  async function refreshInfo() {
    if (!call || disposed) return
    const info = await call<{ url: string }>("info", { name }).catch(() => undefined)
    if (info?.url) setPageUrl(info.url)
  }

  const controls: BrowserSurfaceControls = {
    goto(url) {
      if (!call) return
      setStatus("starting")
      void call("goto", { name, url })
        .then(() => refreshInfo())
        .catch(fail)
    },
    back() {
      void call?.("back", { name })
        .then(() => refreshInfo())
        .catch(fail)
    },
    forward() {
      void call?.("forward", { name })
        .then(() => refreshInfo())
        .catch(fail)
    },
    reload() {
      void call?.("reload", { name }).catch(fail)
    },
    key(input) {
      void call?.("key", { name, input }).catch(() => {})
    },
    toggleTransmission() {
      const next: FrameTransmission = pump.mode === "file" ? "inline" : "file"
      pump.setTransmission(next)
      setTransmission(next)
      void stream()
    },
    zoom(direction) {
      if (props.renderer !== "halfblock") return
      // Zooming *in* means covering fewer page pixels per sample, i.e. a
      // smaller factor — hence the inverted step.
      const next = zoomIndex() - direction
      if (next < 0 || next >= ZOOM_STEPS.length) return
      setZoomIndex(next)
      const size = geometry().viewport
      void call?.("resize", { name, width: size.width, height: size.height })
        .then(() => stream())
        .catch(fail)
    },
  }
  props.ref?.(controls)

  // Placement changes are the only thing that rebuilds the placeholder grid;
  // frames alone never touch OpenTUI's cells.
  createEffect(() => {
    const columns = props.columns
    const rows = props.rows
    if (!pump.setPlacement(columns, rows)) return
    setPlaceholder(pump.placeholder())
    if (!started) return
    clearTimeout(restartTimer)
    restartTimer = setTimeout(() => {
      const size = geometry().viewport
      void call?.("resize", { name, width: size.width, height: size.height })
        .then(() => stream())
        .catch(fail)
    }, 200)
  })

  /**
   * Terminal cell under the pointer → page pixel. The same arithmetic for both
   * renderers, because the viewport is measured in cells either way: the
   * pointer lands at the centre of the cell it is over, scaled by cell size.
   */
  function toPage(event: MouseEvent) {
    const cell = cellSize(renderer.resolution, renderer.terminalWidth, renderer.terminalHeight)
    return {
      x: Math.max(0, Math.round((event.x - (box?.x ?? 0) + 0.5) * cell.width)),
      y: Math.max(0, Math.round((event.y - (box?.y ?? 0) + 0.5) * cell.height)),
    }
  }

  function modifiers(event: MouseEvent) {
    const held: string[] = []
    if (event.modifiers.shift) held.push("shift")
    if (event.modifiers.alt) held.push("alt")
    if (event.modifiers.ctrl) held.push("control")
    return held
  }

  function pointer(input: Record<string, unknown>) {
    void call?.("pointer", { name, input }).catch(() => {})
  }

  createEffect(() => {
    if (props.renderer !== "overlay") return
    const box = overlayBox()
    const bytes = overlayBytes()
    if (!box || !bytes || nativeOverlay) return
    const overlay: NativeOverlay = { box, bytes, columns: props.columns, rows: props.rows }
    nativeOverlay = overlay
    const unregister = registerNativeOverlay(renderer, overlay)
    onCleanup(() => {
      nativeOverlay = undefined
      unregister()
    })
  })

  // Keep the registered overlay's cell extent in step with the placement, or
  // the bounds check would clip it against the wrong rectangle after a resize.
  createEffect(() => {
    if (!nativeOverlay) return
    nativeOverlay.columns = props.columns
    nativeOverlay.rows = props.rows
  })

  onCleanup(() => {
    disposed = true
    clearTimeout(restartTimer)
    streamAbort?.abort()
    pump.destroy()
    if (started && socketPath) {
      void import("@nikcli-ai/browser-control/daemon-client")
        .then(({ rpc }) => rpc(socketPath!, "remove", { name }))
        .catch(() => {})
    }
  })

  void boot()

  return (
    <box
      ref={(value: BoxRenderable) => {
        box = value
      }}
      flexDirection="column"
      width={props.columns}
      height={props.rows}
      flexShrink={0}
      onMouseDown={(event: MouseEvent) => {
        const at = toPage(event)
        pointer({ type: "down", ...at, button: event.button === 2 ? "right" : "left", modifiers: modifiers(event) })
      }}
      onMouseUp={(event: MouseEvent) => {
        const at = toPage(event)
        pointer({ type: "up", ...at, button: event.button === 2 ? "right" : "left", modifiers: modifiers(event) })
      }}
      onMouseMove={(event: MouseEvent) => {
        pointer({ type: "move", ...toPage(event) })
      }}
      onMouseScroll={(event: MouseEvent) => {
        const scroll = event.scroll
        if (!scroll) return
        const magnitude = (scroll.delta || 1) * 120
        const delta =
          scroll.direction === "up"
            ? { deltaY: -magnitude }
            : scroll.direction === "down"
              ? { deltaY: magnitude }
              : scroll.direction === "left"
                ? { deltaX: -magnitude }
                : { deltaX: magnitude }
        pointer({ type: "wheel", ...toPage(event), ...delta })
      }}
    >
      <Show
        when={
          status() !== "error" &&
          (props.renderer === "halfblock"
            ? pixels()
            : props.renderer === "overlay"
              ? overlayBytes()
              : placeholder().length > 0)
        }
        fallback={
          <box paddingLeft={1} paddingTop={1}>
            <text fg={status() === "error" ? theme.error : theme.textMuted} wrapMode="word">
              {status() === "error" ? `✗ ${error()}` : "Starting Chromium…"}
            </text>
          </box>
        }
      >
        <Switch
          fallback={
            <For each={placeholder()}>
              {(row) => {
                const color = pump.color
                return <text fg={RGBA.fromInts(color.r, color.g, color.b, 255)}>{row}</text>
              }}
            </For>
          }
        >
          <Match when={props.renderer === "halfblock"}>
            <nikcli_background width={props.columns} height={props.rows} pixels={pixels()!} base={theme.background} />
          </Match>
          <Match when={props.renderer === "overlay"}>
            {/* Empty: the picture is drawn over these cells by the terminal,
                after OpenTUI flushes. The box exists to pin the position. */}
            <box
              ref={(value: BoxRenderable) => setOverlayBox(value)}
              width={props.columns}
              height={props.rows}
              flexShrink={0}
            />
          </Match>
        </Switch>
      </Show>
    </box>
  )
}

/**
 * Forward a key press to the page. Kept out of the component so the dialog
 * decides which keys are its own (esc, the url bar) before anything reaches
 * Chromium.
 */
export function browserSurfaceKey(
  controls: BrowserSurfaceControls | undefined,
  send: (input: { key?: string; text?: string }) => void,
  event: { name?: string; sequence?: string; ctrl?: boolean; meta?: boolean; shift?: boolean },
): boolean {
  if (!controls) return false
  const name = event.name ?? ""
  if (event.ctrl || event.meta) {
    if (!name) return false
    send({ key: `${event.ctrl ? "ctrl+" : ""}${event.meta ? "meta+" : ""}${name}` })
    return true
  }
  const printable = event.sequence && event.sequence.length === 1 && event.sequence >= " " ? event.sequence : undefined
  if (printable) {
    send({ text: printable })
    return true
  }
  if (name) {
    send({ key: name })
    return true
  }
  return false
}
