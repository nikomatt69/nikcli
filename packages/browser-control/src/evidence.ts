/**
 * Evidence bundling — turn a captured screenshot (+ optional video/trace) into
 * a PR-ready artifact directory: screenshot, demo.mp4, preview.gif, an
 * optional trace.zip, a hash-bearing manifest.json and pr.md. Mirrors
 * terminal-control's `evidence.ts` shape so both packages plug into the same
 * kind of CI evidence-discovery convention, adapted to browser artifacts.
 */
import { createHash } from "node:crypto"
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises"
import { basename, join, relative, resolve, sep } from "node:path"
import { exportVideo, exportVideoFromFrames, createGifPreview } from "./render/video"
import { frameAt, finalFrame, frameAtMarker, type RecordingData } from "./recording"

export type VerificationResult = "passed" | "failed" | "unverified"

export interface EvidenceBundleOptions {
  /**
   * PNG screenshot to use. Provide either this directly (e.g. from
   * `snapshot()` or a `marker()` result), or `recordingData` below to derive
   * one automatically — mirrors terminal-control's `--at-marker`/`--at-ms`.
   */
  readonly screenshotPath?: string
  /**
   * A stopped (or still-running) recording's data. When `screenshotPath` is
   * omitted, the screenshot is derived from it via `atMarker`/`atMs`, or the
   * last sampled frame if neither is given. When `videoPath` is also omitted
   * and the recording has sampled frames, a video is assembled from them.
   */
  readonly recordingData?: RecordingData
  /** Derive the screenshot from this marker's sampled frame. Requires `recordingData`. */
  readonly atMarker?: string
  /** Derive the screenshot from the frame nearest this timestamp (ms). Requires `recordingData`. */
  readonly atMs?: number
  /** mp4 video produced by a session started with `record: true`, after `stop()`. Takes priority over `recordingData` samples. */
  readonly videoPath?: string
  /** trace.zip produced by `stopRecording()`. Can contain page content/network — excluded by default. */
  readonly tracePath?: string
  readonly outputDirectory: string
  readonly result: VerificationResult
  readonly title?: string
  readonly summary?: string
  /** Public repository-relative path used in generated PR Markdown. */
  readonly linkBase?: string
  readonly preview?: boolean
  readonly includeTrace?: boolean
  /** fps for a `recordingData`-sampled video. Defaults to the fps it was recorded at. */
  readonly fps?: number
}

export interface EvidenceArtifact {
  readonly kind: "screenshot" | "video" | "preview" | "trace" | "pr-markdown"
  readonly path: string
  readonly bytes: number
  readonly sha256: string
}

export interface EvidenceManifest {
  readonly version: 1
  readonly createdAt: string
  readonly result: VerificationResult
  readonly title: string
  readonly summary: string
  readonly capture: {
    readonly marker?: string
    readonly atMs?: number
    readonly final: boolean
  }
  readonly artifacts: ReadonlyArray<EvidenceArtifact>
}

export interface EvidenceBundle {
  readonly directory: string
  readonly manifest: string
  readonly screenshot: string
  readonly video?: string
  readonly preview?: string
  readonly trace?: string
  readonly prMarkdown: string
}

function markdownText(value: string): string {
  return value.replace(/[\r\n]+/gu, " ").trim()
}

function statusLine(result: VerificationResult): string {
  if (result === "passed") return "✅ Browser verification passed."
  if (result === "failed") return "❌ Browser verification failed."
  return "⚪ Browser verification recorded without a pass/fail assertion."
}

function normalizedLinkBase(options: EvidenceBundleOptions): string {
  const configured = options.linkBase?.trim()
  if (configured) return configured.replaceAll("\\", "/").replace(/\/$/u, "")
  if (!resolve(options.outputDirectory).startsWith(`${process.cwd()}${sep}`)) return basename(options.outputDirectory)
  return relative(process.cwd(), resolve(options.outputDirectory)).replaceAll("\\", "/") || "."
}

export function renderPullRequestMarkdown(input: {
  readonly result: VerificationResult
  readonly title: string
  readonly summary: string
  readonly linkBase: string
  readonly hasVideo: boolean
  readonly hasPreview: boolean
  readonly hasTrace?: boolean
}): string {
  const title = markdownText(input.title) || "Browser verification"
  const base = input.linkBase.replace(/\/$/u, "")
  const image = input.hasPreview ? `${base}/preview.gif` : `${base}/screenshot.png`
  const lines = [`### ${title}`, "", statusLine(input.result)]
  if (input.summary.trim()) lines.push("", input.summary.trim())
  lines.push("", `![${title}](${image})`)
  if (input.hasVideo) lines.push("", `[Full MP4 recording](${base}/demo.mp4)`)
  if (input.hasTrace) lines.push("", `[Session trace](${base}/trace.zip)`)
  lines.push("")
  return lines.join("\n")
}

async function fingerprint(path: string, kind: EvidenceArtifact["kind"], directory: string): Promise<EvidenceArtifact> {
  const data = await readFile(path)
  return {
    kind,
    path: relative(directory, path).replaceAll("\\", "/"),
    bytes: data.byteLength,
    sha256: createHash("sha256").update(data).digest("hex"),
  }
}

function captureSelector(options: EvidenceBundleOptions): { marker?: string; atMs?: number } {
  if (options.atMarker !== undefined && options.atMs !== undefined) {
    throw new Error("Evidence capture accepts either atMarker or atMs, not both.")
  }
  return {
    ...(options.atMarker !== undefined ? { marker: options.atMarker } : {}),
    ...(options.atMs !== undefined ? { atMs: options.atMs } : {}),
  }
}

/** Resolve the screenshot source: explicit path wins, else derive from `recordingData`. */
function resolveScreenshotSource(options: EvidenceBundleOptions): string {
  if (options.screenshotPath) return resolve(options.screenshotPath)
  if (!options.recordingData) {
    throw new Error("Evidence bundle needs either screenshotPath or recordingData.")
  }
  const rec = options.recordingData
  const frame =
    options.atMarker !== undefined
      ? frameAtMarker(rec, options.atMarker)
      : options.atMs !== undefined
        ? frameAt(rec, options.atMs)
        : finalFrame(rec)
  if (!frame) throw new Error("recordingData has no sampled frames — start recording with sampleFps set.")
  return frame.path
}

export async function createEvidenceBundle(options: EvidenceBundleOptions): Promise<EvidenceBundle> {
  const screenshotPath = resolveScreenshotSource(options)
  const screenshotInfo = await stat(screenshotPath).catch(() => undefined)
  if (!screenshotInfo?.isFile()) throw new Error(`Screenshot does not exist: ${screenshotPath}`)

  const directory = resolve(options.outputDirectory)
  await mkdir(directory, { recursive: true })

  const screenshot = join(directory, "screenshot.png")
  if (screenshot !== screenshotPath) await copyFile(screenshotPath, screenshot)

  let video: string | undefined
  let preview: string | undefined
  if (options.videoPath) {
    const sourceVideo = resolve(options.videoPath)
    const videoInfo = await stat(sourceVideo).catch(() => undefined)
    if (!videoInfo?.isFile()) throw new Error(`Video does not exist: ${sourceVideo}`)
    video = join(directory, "demo.mp4")
    await exportVideo(sourceVideo, { format: "mp4", outPath: video })
  } else if (options.recordingData && options.recordingData.samples.length > 0) {
    video = join(directory, "demo.mp4")
    await exportVideoFromFrames(options.recordingData.samples, {
      format: "mp4",
      outPath: video,
      fps: options.fps ?? options.recordingData.sampleFps,
    })
  }
  if (video && (options.preview ?? true)) {
    preview = join(directory, "preview.gif")
    await createGifPreview(video, preview)
  }

  let trace: string | undefined
  if (options.tracePath && options.includeTrace) {
    const sourceTrace = resolve(options.tracePath)
    const traceInfo = await stat(sourceTrace).catch(() => undefined)
    if (traceInfo?.isFile()) {
      trace = join(directory, "trace.zip")
      if (trace !== sourceTrace) await copyFile(sourceTrace, trace)
    }
  }

  const title = markdownText(options.title ?? "Browser verification") || "Browser verification"
  const summary = options.summary?.trim() ?? ""
  const prMarkdown = join(directory, "pr.md")
  const markdown = renderPullRequestMarkdown({
    result: options.result,
    title,
    summary,
    linkBase: normalizedLinkBase(options),
    hasVideo: video !== undefined,
    hasPreview: preview !== undefined,
    hasTrace: trace !== undefined,
  })
  await writeFile(prMarkdown, markdown)

  const artifacts = await Promise.all([
    fingerprint(screenshot, "screenshot", directory),
    ...(video ? [fingerprint(video, "video" as const, directory)] : []),
    ...(preview ? [fingerprint(preview, "preview" as const, directory)] : []),
    ...(trace ? [fingerprint(trace, "trace" as const, directory)] : []),
    fingerprint(prMarkdown, "pr-markdown", directory),
  ])

  const selector = captureSelector(options)
  const manifestData: EvidenceManifest = {
    version: 1,
    createdAt: new Date().toISOString(),
    result: options.result,
    title,
    summary,
    capture: { ...selector, final: selector.marker === undefined && selector.atMs === undefined },
    artifacts,
  }
  const manifest = join(directory, "manifest.json")
  await writeFile(manifest, `${JSON.stringify(manifestData, null, 2)}\n`)

  return {
    directory,
    manifest,
    screenshot,
    ...(video ? { video } : {}),
    ...(preview ? { preview } : {}),
    ...(trace ? { trace } : {}),
    prMarkdown,
  }
}
