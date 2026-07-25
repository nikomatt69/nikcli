/**
 * Recording — captures a session's timeline as a sequence of real desktop
 * screenshots and a list of named markers.
 *
 * terminal-control's `Recorder` records raw ANSI bytes so it can replay an
 * exact screen at any past millisecond — a terminal is discrete, finite
 * state, so that's free. A rendered desktop has no equivalent: there is no
 * "replay" of a real screen. The closest honest analog is periodic sampling
 * — `start({ sampleFps })` takes a real screenshot on a timer for the life
 * of the recording, and {@link frameAt}/{@link frameAtMarker} pick the
 * nearest sample to a moment. This is an approximation (accurate to
 * ~1/fps seconds), not exact reconstruction, but it's usable *while the
 * session is still running* and after the session has stopped (for evidence
 * extraction).
 */
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Backend } from "./backends"
import type { ComputerFrame, ScreenSize } from "./frame"

export const RECORDING_VERSION = 1 as const

export interface RecordingMarker {
  readonly time: number
  readonly name: string
  /** Absolute path to a PNG screenshot taken at this marker. */
  readonly screenshot: string
}

export interface SampledFrame {
  readonly time: number
  /** Absolute path to a PNG screenshot taken at this moment. */
  readonly path: string
}

export interface RecordingData {
  readonly version: typeof RECORDING_VERSION
  readonly startedAt: number
  readonly duration: number
  readonly mode: "sandbox" | "host"
  readonly screen: ScreenSize
  /** sampleFps the recording was started with, when set. */
  readonly sampleFps?: number
  readonly samples: ReadonlyArray<SampledFrame>
  readonly markers: ReadonlyArray<RecordingMarker>
}

export interface StartRecordingOptions {
  /** Periodic screenshot rate for {@link frameAt}/video export. Omit to disable sampling (markers-only). */
  readonly sampleFps?: number
}

export class Recorder {
  private readonly markers: RecordingMarker[] = []
  private readonly samples: SampledFrame[] = []
  private readonly startedAt = Date.now()
  private readonly mode: "sandbox" | "host"
  private readonly screen: ScreenSize
  private stopped = false
  private workDir: string | null = null
  private sampleFps: number | undefined
  private sampleTimer: ReturnType<typeof setInterval> | undefined

  constructor(
    private readonly backend: Backend,
    initialScreen: ScreenSize,
  ) {
    this.mode = backend.mode
    this.screen = initialScreen
  }

  get active(): boolean {
    return !this.stopped
  }

  async start(options: StartRecordingOptions = {}): Promise<void> {
    this.workDir = await mkdtemp(join(tmpdir(), "computer-use-rec-"))
    if (options.sampleFps && options.sampleFps > 0) {
      this.sampleFps = options.sampleFps
      const intervalMs = Math.max(100, Math.round(1000 / options.sampleFps))
      this.sampleTimer = setInterval(() => void this.captureSample(), intervalMs)
    }
  }

  private async captureSample(): Promise<void> {
    if (this.stopped || !this.workDir) return
    const time = Date.now() - this.startedAt
    const path = join(this.workDir, `frame-${String(this.samples.length).padStart(6, "0")}.png`)
    let bytes: Uint8Array | undefined
    try {
      bytes = await this.backend.screenshot()
    } catch {
      return
    }
    await Bun.write(path, bytes).catch(() => {})
    this.samples.push({ time, path })
  }

  /** Take a labeled screenshot at the current moment. No-op once stopped. */
  async marker(name: string): Promise<RecordingMarker | undefined> {
    if (this.stopped) return undefined
    const dir = this.workDir ?? tmpdir()
    const path = join(dir, `marker-${this.markers.length}-${name.replace(/[^a-z0-9_-]/gi, "_")}.png`)
    let bytes: Uint8Array | undefined
    try {
      bytes = await this.backend.screenshot()
    } catch {
      return undefined
    }
    await Bun.write(path, bytes).catch(() => {})
    const marker: RecordingMarker = {
      time: Date.now() - this.startedAt,
      name,
      screenshot: path,
    }
    this.markers.push(marker)
    return marker
  }

  async stop(): Promise<RecordingData> {
    if (!this.stopped) {
      this.stopped = true
      if (this.sampleTimer) clearInterval(this.sampleTimer)
    }
    return this.data()
  }

  /** Current recording state without stopping — samples/markers so far are usable immediately. */
  data(): RecordingData {
    return {
      version: RECORDING_VERSION,
      startedAt: this.startedAt,
      duration: Date.now() - this.startedAt,
      mode: this.mode,
      screen: this.screen,
      ...(this.sampleFps ? { sampleFps: this.sampleFps } : {}),
      samples: this.samples.slice(),
      markers: this.markers.slice(),
    }
  }
}

/** Total duration of a recording in milliseconds. */
export function duration(rec: RecordingData): number {
  if (rec.duration > 0) return rec.duration
  const last = rec.samples[rec.samples.length - 1]
  return last ? last.time : 0
}

/** The sampled frame nearest to `timeMs` (approximate — accurate to ~1/sampleFps seconds), or undefined if nothing was sampled. */
export function frameAt(rec: RecordingData, timeMs: number): SampledFrame | undefined {
  if (rec.samples.length === 0) return undefined
  let closest = rec.samples[0]!
  let bestDelta = Math.abs(closest.time - timeMs)
  for (const sample of rec.samples) {
    const delta = Math.abs(sample.time - timeMs)
    if (delta < bestDelta) {
      closest = sample
      bestDelta = delta
    }
  }
  return closest
}

/** The last sampled frame, or undefined if nothing was sampled. */
export function finalFrame(rec: RecordingData): SampledFrame | undefined {
  return rec.samples[rec.samples.length - 1]
}

/** The sampled frame nearest a named marker's timestamp. Throws if the marker doesn't exist. */
export function frameAtMarker(rec: RecordingData, markerName: string): SampledFrame | undefined {
  const marker = rec.markers.find((m) => m.name === markerName)
  if (!marker) throw new Error(`Marker "${markerName}" not found in recording.`)
  return frameAt(rec, marker.time)
}

/** Load a sampled frame as a {@link ComputerFrame} for rendering. */
export async function loadFrame(
  sample: SampledFrame,
  mode: "sandbox" | "host",
  screen: ScreenSize,
): Promise<ComputerFrame> {
  const file = Bun.file(sample.path)
  const bytes = new Uint8Array(await file.arrayBuffer())
  return {
    mode,
    screen,
    screenshot: bytes,
    capturedAt: sample.time,
  }
}
