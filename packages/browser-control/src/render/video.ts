/**
 * Video export — transcode a recorded session video (or assemble a PNG
 * sequence) via the `ffmpeg` binary.
 */
import { dirname, delimiter } from "node:path"
import type { SampledFrame } from "../recording"

export type VideoFormat = "mp4" | "gif"

export interface ExportVideoOptions {
  readonly format?: VideoFormat
  /** Absolute path for the output file. */
  readonly outPath: string
}

export interface ExportVideoResult {
  readonly path: string
  readonly format: VideoFormat
}

/** True if the `ffmpeg` binary is available on PATH. */
export function ffmpegAvailable(): boolean {
  return Bun.which("ffmpeg") !== null
}

/** Resolve an ffmpeg binary, falling back to the bundled `@ffmpeg-installer/ffmpeg`. */
export async function resolveFfmpegBinary(): Promise<string> {
  const system = Bun.which("ffmpeg")
  if (system) return system
  const module = await import("@ffmpeg-installer/ffmpeg")
  const installer = module.default
  if (installer.path) return installer.path
  throw new Error("Video export requires ffmpeg, but neither PATH nor @ffmpeg-installer/ffmpeg provides it.")
}

async function run(command: readonly string[], env?: Record<string, string | undefined>): Promise<void> {
  const proc = Bun.spawn([...command], { stdout: "ignore", stderr: "pipe", ...(env ? { env } : {}) })
  const stderr = new Response(proc.stderr).text()
  const [code, errors] = await Promise.all([proc.exited, stderr])
  if (code !== 0) throw new Error(`ffmpeg exited with code ${code}: ${errors.trim().slice(-2_000)}`)
}

/** Transcode a recorded video file into an MP4 or GIF. */
export async function exportVideo(inputPath: string, options: ExportVideoOptions): Promise<ExportVideoResult> {
  const ffmpeg = await resolveFfmpegBinary()
  const format = options.format ?? "mp4"
  const env = { ...process.env, PATH: [dirname(ffmpeg), process.env.PATH].filter(Boolean).join(delimiter) }

  if (format === "gif") {
    await run(
      [
        ffmpeg,
        "-y",
        "-loglevel",
        "error",
        "-i",
        inputPath,
        "-filter_complex",
        "fps=10,scale=w='min(960,iw)':h=-2:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer",
        "-loop",
        "0",
        options.outPath,
      ],
      env,
    )
  } else {
    await run(
      [
        ffmpeg,
        "-y",
        "-loglevel",
        "error",
        "-i",
        inputPath,
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        // h264 requires even dimensions.
        "-vf",
        "pad=ceil(iw/2)*2:ceil(ih/2)*2",
        options.outPath,
      ],
      env,
    )
  }

  return { path: options.outPath, format }
}

/** Produce a looping GIF preview directly from an already-exported MP4. */
export async function createGifPreview(videoPath: string, outPath: string): Promise<void> {
  await exportVideo(videoPath, { format: "gif", outPath })
}

export interface ExportFramesOptions extends ExportVideoOptions {
  /** Playback rate for the assembled video. Defaults to the fps the frames were sampled at (or 4). */
  readonly fps?: number
}

export interface ExportFramesResult extends ExportVideoResult {
  readonly frames: number
  readonly fps: number
}

/**
 * Assemble a fixed-fps PNG sequence (from {@link Recorder}'s periodic sampling)
 * into an MP4 or GIF — usable at any point, including while the session that
 * produced the frames is still running.
 */
export async function exportVideoFromFrames(
  frames: ReadonlyArray<SampledFrame>,
  options: ExportFramesOptions,
): Promise<ExportFramesResult> {
  if (frames.length === 0) throw new Error("No sampled frames to export. Start recording with sampleFps set.")
  const ffmpeg = await resolveFfmpegBinary()
  const format = options.format ?? "mp4"
  const fps = options.fps && options.fps > 0 ? options.fps : 4
  const env = { ...process.env, PATH: [dirname(ffmpeg), process.env.PATH].filter(Boolean).join(delimiter) }

  const args =
    format === "gif"
      ? [
          "-y",
          "-loglevel",
          "error",
          "-f",
          "image2pipe",
          "-framerate",
          String(fps),
          "-i",
          "-",
          "-filter_complex",
          "split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer",
          "-loop",
          "0",
          options.outPath,
        ]
      : [
          "-y",
          "-loglevel",
          "error",
          "-f",
          "image2pipe",
          "-framerate",
          String(fps),
          "-i",
          "-",
          "-c:v",
          "libx264",
          "-pix_fmt",
          "yuv420p",
          "-vf",
          "pad=ceil(iw/2)*2:ceil(ih/2)*2",
          options.outPath,
        ]

  const proc = Bun.spawn([ffmpeg, ...args], { stdin: "pipe", stdout: "ignore", stderr: "pipe", env })
  const writer = proc.stdin
  for (const frame of frames) {
    const bytes = await Bun.file(frame.path)
      .arrayBuffer()
      .catch(() => undefined)
    if (bytes) writer.write(new Uint8Array(bytes))
  }
  await writer.end()
  const [code, errors] = await Promise.all([proc.exited, new Response(proc.stderr).text()])
  if (code !== 0) throw new Error(`ffmpeg exited with code ${code}: ${errors.trim().slice(-2_000)}`)

  return { path: options.outPath, format, frames: frames.length, fps }
}
