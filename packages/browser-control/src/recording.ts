/**
 * Recording — a fixed-fps sequence of real screenshots and named markers.
 *
 * A rendered page has no replayable byte stream the way a terminal does.
 * Periodic sampling (`start({ sampleFps })`) takes a real screenshot on a
 * timer, and {@link frameAt}/{@link frameAtMarker} pick the nearest sample.
 */
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Viewport } from "./frame"

export const RECORDING_VERSION = 1 as const

export interface RecordingMarker {
  readonly time: number
  readonly name: string
  readonly screenshot: string
}

export interface SampledFrame {
  readonly time: number
  readonly path: string
}

export interface RecordingData {
  readonly version: typeof RECORDING_VERSION
  readonly startedAt: number
  readonly duration: number
  readonly url: string
  readonly viewport: Viewport
  readonly trace?: string
  readonly sampleFps?: number
  readonly samples: ReadonlyArray<SampledFrame>
  readonly markers: ReadonlyArray<RecordingMarker>
}

export interface StartRecordingOptions {
  readonly sampleFps?: number
}

export type RecordingCapture = (path: string) => Promise<boolean>
export type RecordingUrl = () => string

export class Recorder {
  private readonly markers: RecordingMarker[] = []
  private readonly samples: SampledFrame[] = []
  private readonly startedAt = Date.now()
  private stopped = false
  private workDir: string | null = null
  private sampleFps: number | undefined
  private sampleTimer: ReturnType<typeof setInterval> | undefined

  constructor(
    private readonly capture: RecordingCapture,
    private readonly currentUrl: RecordingUrl,
    private readonly viewport: Viewport,
  ) {}

  get active(): boolean {
    return !this.stopped
  }

  async start(options: StartRecordingOptions = {}): Promise<void> {
    this.workDir = await mkdtemp(join(tmpdir(), "browser-control-rec-"))
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
    const ok = await this.capture(path)
    if (ok) this.samples.push({ time, path })
  }

  async marker(name: string): Promise<RecordingMarker | undefined> {
    if (this.stopped) return undefined
    const dir = this.workDir ?? tmpdir()
    const path = join(dir, `marker-${this.markers.length}-${name.replace(/[^a-z0-9_-]/gi, "_")}.png`)
    await this.capture(path)
    const marker: RecordingMarker = { time: Date.now() - this.startedAt, name, screenshot: path }
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

  data(): RecordingData {
    return {
      version: RECORDING_VERSION,
      startedAt: this.startedAt,
      duration: Date.now() - this.startedAt,
      url: this.currentUrl(),
      viewport: this.viewport,
      ...(this.sampleFps ? { sampleFps: this.sampleFps } : {}),
      samples: this.samples.slice(),
      markers: this.markers.slice(),
    }
  }
}

export function duration(rec: RecordingData): number {
  if (rec.duration > 0) return rec.duration
  const last = rec.samples[rec.samples.length - 1]
  return last ? last.time : 0
}

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

export function finalFrame(rec: RecordingData): SampledFrame | undefined {
  return rec.samples[rec.samples.length - 1]
}

export function frameAtMarker(rec: RecordingData, markerName: string): SampledFrame | undefined {
  const marker = rec.markers.find((m) => m.name === markerName)
  if (!marker) throw new Error(`Marker "${markerName}" not found in recording.`)
  return frameAt(rec, marker.time)
}
