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
import { InputScheduler } from "@tui/util/browser-input"
import { preparePhoton } from "@/image/photon"
import { registerNativeOverlay, type NativeOverlay } from "./tui-image"
import { useSync } from "@tui/context/sync"
import { useTheme } from "@tui/context/theme" 

export type BrowserSurfaceStatus = "starting" | "live" | "error"

/**
 * How the page's pixels get onto the screen.
 *
 * - `kitty` composites a real image over placeholder cells: full resolution,
 *   needs a terminal that implements the Kitty graphics protocol.
 * - `overlay` draws a real Sixel image over the grid, positioned after OpenTUI
 *   flushes its frame. Full resolution like `kitty`, but it costs a quantise
 *   per frame. This is what the VS Code / Cursor terminal can do, once
 *   `terminal.integrated.enableImages` is turned on.
 *
 * A terminal with neither has no live view: it reads pages as markdown instead
 * of being shown an approximation of one in block characters.
 */
export type SurfaceRenderer = "kitty" | "overlay"

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
}

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
  const [status, setStatus] = createSignal<BrowserSurfaceStatus>("starting")
  const [error, setError] = createSignal<string | undefined>()
  const [pageUrl, setPageUrl] = createSignal(props.initialUrl)
  const [title, setTitle] = createSignal("")
  const [measured, setMeasured] = createSignal(true)
  const [transmission, setTransmission] = createSignal<FrameTransmission>(pump.mode)
  const [overlayBytes, setOverlayBytes] = createSignal<Uint8Array | undefined>()
  const [overlayBox, setOverlayBox] = createSignal<BoxRenderable>()
  const [stats, setStats] = createSignal<PumpStats>(pump.stats)

  let socketPath: string | undefined
  let call: (<T>(method: string, params?: Record<string, unknown>) => Promise<T>) | undefined
  let streamAbort: AbortController | undefined
  let started = false
  let disposed = false
  let restartTimer: ReturnType<typeof setTimeout> | undefined
  let rateTimer: ReturnType<typeof setTimeout> | undefined
  let box: BoxRenderable | undefined
  let generation = 0
  /** The rate the open stream was asked for, so a focus change only reopens it when it differs. */
  let streamedFps = 0
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
    })

  createEffect(emit)

  const fail = (cause: unknown) => {
    if (disposed) return
    setError(cause instanceof Error ? cause.message : String(cause))
    setStatus("error")
  }

  /**
   * The page viewport, in pixels: one page pixel per screen pixel, from the
   * terminal's own cell size. Capture is always the same size as the viewport —
   * Chromium is asked for exactly the pixels the placement can show, so nothing
   * is captured to be thrown away and nothing is scaled up to fill.
   */
  const geometry = () => {
    const cell = cellSize(renderer.resolution, renderer.terminalWidth, renderer.terminalHeight)
    setMeasured(cell.measured)
    const size = {
      width: Math.max(64, Math.round(props.columns * cell.width)),
      height: Math.max(64, Math.round(props.rows * cell.height)),
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
   * Frames per second to ask Chromium for.
   *
   * A page nobody is looking at still repaints — a carousel, a spinner, an ad —
   * and every one of those frames costs a capture, a transfer and (on Sixel) a
   * quantise, for a picture the user is not reading. Unfocused, the stream drops
   * to a heartbeat: enough that the box is never visibly stale when focus comes
   * back, cheap enough to forget about. Sixel pays a quantise per frame
   * (~130ms at full resolution), so it asks for fewer even when focused.
   */
  const frameRate = () => (props.focused ? (props.renderer === "overlay" ? 6 : 10) : 1)

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
    const overlay = props.renderer === "overlay"
    const { capture } = geometry()
    streamedFps = frameRate()
    try {
      for await (const frame of openScreencast(socketPath, {
        name,
        // Sixel has to resample the picture to quantise it, so it needs the
        // bytes in this process; `file` mode's whole point is *not* moving them.
        mode: overlay ? "inline" : pump.mode,
        maxWidth: capture.width,
        maxHeight: capture.height,
        fps: streamedFps,
        signal: abort.signal,
      })) {
        if (disposed || mine !== generation) break
        if (overlay) await paintOverlay(frame.pngBase64)
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

  /** Start (or replace) this surface's session and attach the frame stream. */
  async function startSession(url: string) {
    if (!call) await connect()
    if (disposed) return
    await call!("start", { name, url, viewport: geometry().viewport })
    if (disposed) return
    started = true
    void refreshInfo()
    void stream()
  }

  async function boot() {
    try {
      await startSession(props.initialUrl)
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
    /**
     * Typing an address is also the retry: if the surface never came up (a
     * daemon that failed to start, a session the daemon has since dropped),
     * this starts one on the URL just typed rather than reporting the session
     * missing — which is all "No browser session named …" ever meant here.
     */
    goto(url) {
      setStatus("starting")
      setError(undefined)
      void (async () => {
        if (!started) return startSession(url)
        try {
          await call!("goto", { name, url })
        } catch (cause) {
          if (!/No browser session/i.test(cause instanceof Error ? cause.message : String(cause))) throw cause
          started = false
          return startSession(url)
        }
        await refreshInfo()
      })().catch(fail)
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

  // Focus decides the frame rate, and the rate is fixed when the stream opens,
  // so a change means reopening it. Debounced: tabbing between the address bar
  // and the page must not tear the stream down twice in a keystroke.
  createEffect(() => {
    const wanted = frameRate()
    if (!started || wanted === streamedFps) return
    clearTimeout(rateTimer)
    rateTimer = setTimeout(() => void stream(), 250)
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

  /**
   * Pointer traffic goes through the scheduler, so a drag or a fast scroll
   * costs one RPC per frame instead of one per cell crossed or notch turned.
   */
  const input = new InputScheduler({
    send: (payload) => void call?.("pointer", { name, input: payload }).catch(() => {}),
  })
  onCleanup(() => input.dispose())

  function pointer(payload: Record<string, unknown> & { type: string }) {
    input.push(payload)
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
    clearTimeout(rateTimer)
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
          (props.renderer === "overlay" ? overlayBytes() : placeholder().length > 0)
        }
        fallback={
          <box paddingLeft={1} paddingTop={1} gap={1}>
            <text fg={status() === "error" ? theme.error : theme.textMuted} wrapMode="word">
              {status() === "error" ? `✗ ${error()}` : "Starting Chromium…"}
            </text>
            <Show when={status() === "error"}>
              <text fg={theme.textMuted} wrapMode="word">
                Press ^⇧R for reader mode (no Chromium), or fix the browser-control daemon and reopen.
              </text>
            </Show>
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
