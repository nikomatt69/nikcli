/**
 * KittyFramePump — turns a stream of browser frames into terminal graphics.
 *
 * The pump owns exactly one Kitty image id for its lifetime. Every frame is a
 * transmission under that *same* id, which replaces the picture in place; the
 * placeholder cells the terminal composites it over never change, so on a
 * steady stream OpenTUI's grid is byte-identical between frames and only the
 * graphics command moves. That asymmetry is what makes video rates affordable
 * in a TUI: the expensive thing (a full grid repaint) happens on resize, not
 * on every frame.
 *
 * Backpressure is handled by dropping, never by queueing. A terminal that
 * falls behind must not accumulate a backlog of stale pictures — a live view
 * wants the current pixels or nothing. `process.stdout.write` returning
 * `false` is the signal; frames arriving before the subsequent `drain` are
 * discarded and counted.
 */
import {
  deleteKittyVirtual,
  encodeKittyVirtualFile,
  encodeKittyVirtualPng,
  kittyIdColor,
  kittyPlaceholderGrid,
  MAX_PLACEHOLDER_DIMENSION,
} from "@nikcli-ai/tui-image"

/**
 * How the pixels reach the terminal.
 *
 * `file` sends a path the terminal reads for itself — a fixed ~430 bytes per
 * frame regardless of the picture. `inline` sends base64 through the PTY,
 * which every Kitty-capable terminal accepts but which scales with how
 * complicated the page looks.
 *
 * `inline` is the default despite costing an order of magnitude more bytes,
 * because it is the one that is *guaranteed* to draw: `t=t` additionally
 * requires the terminal to read and delete a file we hand it, and a terminal
 * that declines simply renders nothing while reporting nothing (`q=2`
 * suppresses every reply). Ghostty was observed doing exactly that. The cheap
 * path stays one keystroke away — see the transport toggle in the surface.
 */
export type FrameTransmission = "file" | "inline"

/** One frame as it arrives from the browser-control daemon. */
export interface PumpFrame {
  readonly seq: number
  readonly width: number
  readonly height: number
  readonly path?: string
  readonly pngBase64?: string
}

export interface BrowserFramePumpOptions {
  /** Injected so the pump can be unit-tested without a terminal. */
  readonly writer?: (sequence: string) => boolean
  readonly transmission?: FrameTransmission
}

export interface PumpStats {
  readonly presented: number
  readonly dropped: number
  readonly bytes: number
}

// Image ids are per terminal session; offsetting by pid keeps concurrent or
// successive nikcli processes from overwriting each other's images. Kept
// distinct from `tui-image.tsx`'s counter space by starting high.
let pumpIdCounter = 0
const pumpIdBase = ((((typeof process !== "undefined" ? process.pid : 0) ?? 0) & 0x7f) | 0x80) << 16

function nextPumpId(): number {
  pumpIdCounter = (pumpIdCounter % 0xffff) + 1
  return pumpIdBase + pumpIdCounter
}

const defaultWriter = (sequence: string): boolean => {
  if (typeof process === "undefined" || !process.stdout) return false
  try {
    return process.stdout.write(sequence)
  } catch {
    return false
  }
}

export class BrowserFramePump {
  readonly id: number
  private readonly writer: (sequence: string) => boolean
  private transmission: FrameTransmission
  private columns = 0
  private rows = 0
  private blocked = false
  private destroyed = false
  private presented = 0
  private dropped = 0
  private bytes = 0

  constructor(options: BrowserFramePumpOptions = {}) {
    this.id = nextPumpId()
    this.writer = options.writer ?? defaultWriter
    this.transmission = options.transmission ?? "inline"
    // Always listen, even behind an injected writer: `drain` is the only thing
    // that ever clears `blocked`, so a pump that skipped this would drop every
    // frame forever after the first slow write.
    if (typeof process !== "undefined" && process.stdout) process.stdout.on("drain", this.onDrain)
  }

  private onDrain = () => {
    this.blocked = false
  }

  /** Clear backpressure explicitly. Only needed by transports that aren't stdout. */
  resume(): void {
    this.blocked = false
  }

  /** The 24-bit foreground every placeholder cell of this image must use. */
  get color(): { r: number; g: number; b: number } {
    return kittyIdColor(this.id)
  }

  get stats(): PumpStats {
    return { presented: this.presented, dropped: this.dropped, bytes: this.bytes }
  }

  get mode(): FrameTransmission {
    return this.transmission
  }

  /**
   * Switch transmission at runtime. Exposed because a terminal that ignores
   * `t=t` shows *nothing at all* and answers no query about it (`q=2`
   * suppresses every response), so the only honest diagnostic is letting a
   * human flip the switch and see which half works.
   */
  setTransmission(transmission: FrameTransmission): void {
    this.transmission = transmission
  }

  /**
   * Placeholder cells for the current placement, or an empty array when no
   * placement has been set. Render each row with {@link color} as foreground.
   */
  placeholder(): string[] {
    if (this.columns <= 0 || this.rows <= 0) return []
    return kittyPlaceholderGrid(this.columns, this.rows)
  }

  /**
   * Resize the placement. Returns `true` when the geometry actually changed,
   * so callers can avoid rebuilding the placeholder grid on every layout pass.
   */
  setPlacement(columns: number, rows: number): boolean {
    const nextColumns = Math.max(0, Math.min(Math.floor(columns), MAX_PLACEHOLDER_DIMENSION))
    const nextRows = Math.max(0, Math.min(Math.floor(rows), MAX_PLACEHOLDER_DIMENSION))
    if (nextColumns === this.columns && nextRows === this.rows) return false
    this.columns = nextColumns
    this.rows = nextRows
    return true
  }

  /** Present a frame, or drop it if the terminal is behind. */
  present(frame: PumpFrame): boolean {
    if (this.destroyed || this.columns <= 0 || this.rows <= 0) return false
    if (this.blocked) {
      this.dropped++
      return false
    }

    const useFile = this.transmission === "file" && frame.path !== undefined
    let sequence: string
    if (useFile) {
      sequence = encodeKittyVirtualFile(frame.path!, { id: this.id, columns: this.columns, rows: this.rows })
    } else {
      const base64 = frame.pngBase64
      if (base64 === undefined) {
        // `file` mode was requested upstream but this pump wants bytes. Nothing
        // to draw — report the drop rather than silently stalling.
        this.dropped++
        return false
      }
      sequence = encodeKittyVirtualPng(Uint8Array.fromBase64(base64), {
        id: this.id,
        columns: this.columns,
        rows: this.rows,
      })
    }

    this.bytes += sequence.length
    this.presented++
    if (!this.writer(sequence)) this.blocked = true
    return true
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    if (typeof process !== "undefined" && process.stdout) process.stdout.off("drain", this.onDrain)
    if (this.presented > 0) this.writer(deleteKittyVirtual(this.id))
  }
}

/**
 * Terminal cell size in pixels, derived from the renderer's negotiated
 * resolution. Every mapping in the live view — the viewport we ask the WebView
 * for, and the page coordinates a click lands on — is built on this, so the
 * fallback is deliberately conservative and reported rather than hidden.
 */
export function cellSize(
  resolution: { width: number; height: number } | null | undefined,
  terminalWidth: number,
  terminalHeight: number,
): { width: number; height: number; measured: boolean } {
  if (resolution && resolution.width > 0 && resolution.height > 0 && terminalWidth > 0 && terminalHeight > 0) {
    const width = resolution.width / terminalWidth
    const height = resolution.height / terminalHeight
    if (width >= 1 && height >= 1) return { width, height, measured: true }
  }
  return { width: 10, height: 20, measured: false }
}
