/**
 * Evidence bundling — turn a captured screenshot (and optional recording) into
 * a PR-ready artifact directory: screenshot, demo.mp4, preview.gif, a
 * hash-bearing manifest.json and pr.md. Mirrors
 * `@nikcli-ai/browser-control`'s evidence shape one-to-one, so the same
 * discovery / merge helpers in CI can treat both the same way.
 *
 * Because there's no real "video" of a desktop session the way Playwright
 * produces a webm, the bundle's video (when present) is assembled from the
 * recorder's periodic sampled screenshots.
 */
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, join, relative, resolve, sep } from "node:path";
import { createGifPreview, exportVideoFromFrames } from "./render/video";
import {
  finalFrame,
  frameAt,
  frameAtMarker,
  type RecordingData,
} from "./recording";

export type VerificationResult = "passed" | "failed" | "unverified";

export interface EvidenceBundleOptions {
  /**
   * PNG screenshot to use. Provide either this directly (e.g. from
   * `snapshot()` or a `marker()` result), or `recordingData` below to derive
   * one automatically — mirrors browser-control's `--at-marker`/`--at-ms`.
   */
  readonly screenshotPath?: string;
  /**
   * A stopped (or still-running) recording's data. When `screenshotPath` is
   * omitted, the screenshot is derived from it via `atMarker`/`atMs`, or the
   * last sampled frame if neither is given. When no explicit video path is
   * provided and the recording has sampled frames, a video is assembled
   * from them.
   */
  readonly recordingData?: RecordingData;
  /** Derive the screenshot from this marker's sampled frame. Requires `recordingData`. */
  readonly atMarker?: string;
  /** Derive the screenshot from the frame nearest this timestamp (ms). Requires `recordingData`. */
  readonly atMs?: number;
  readonly outputDirectory: string;
  readonly result: VerificationResult;
  readonly title?: string;
  readonly summary?: string;
  /** Public repository-relative path used in generated PR Markdown. */
  readonly linkBase?: string;
  readonly preview?: boolean;
  /** fps for a `recordingData`-sampled video. Defaults to the fps it was recorded at. */
  readonly fps?: number;
}

export interface EvidenceArtifact {
  readonly kind: "screenshot" | "video" | "preview" | "pr-markdown";
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface EvidenceManifest {
  readonly version: 1;
  readonly createdAt: string;
  readonly result: VerificationResult;
  readonly title: string;
  readonly summary: string;
  readonly capture: {
    readonly marker?: string;
    readonly atMs?: number;
    readonly final: boolean;
  };
  readonly artifacts: ReadonlyArray<EvidenceArtifact>;
}

export interface EvidenceBundle {
  readonly directory: string;
  readonly manifest: string;
  readonly screenshot: string;
  readonly video?: string;
  readonly preview?: string;
  readonly prMarkdown: string;
}

function markdownText(value: string): string {
  return value.replace(/[\r\n]+/gu, " ").trim();
}

function statusLine(result: VerificationResult): string {
  if (result === "passed") return "✅ Computer verification passed.";
  if (result === "failed") return "❌ Computer verification failed.";
  return "⚪ Computer verification recorded without a pass/fail assertion.";
}

function normalizedLinkBase(options: EvidenceBundleOptions): string {
  const configured = options.linkBase?.trim();
  if (configured) return configured.replaceAll("\\", "/").replace(/\/$/u, "");
  if (!resolve(options.outputDirectory).startsWith(`${process.cwd()}${sep}`))
    return basename(options.outputDirectory);
  return (
    relative(process.cwd(), resolve(options.outputDirectory)).replaceAll(
      "\\",
      "/",
    ) || "."
  );
}

export function renderPullRequestMarkdown(input: {
  readonly result: VerificationResult;
  readonly title: string;
  readonly summary: string;
  readonly linkBase: string;
  readonly hasVideo: boolean;
  readonly hasPreview: boolean;
}): string {
  const title = markdownText(input.title) || "Computer verification";
  const base = input.linkBase.replace(/\/$/u, "");
  const image = input.hasPreview
    ? `${base}/preview.gif`
    : `${base}/screenshot.png`;
  const lines = [`### ${title}`, "", statusLine(input.result)];
  if (input.summary.trim()) lines.push("", input.summary.trim());
  lines.push("", `![${title}](${image})`);
  if (input.hasVideo) lines.push("", `[Full MP4 recording](${base}/demo.mp4)`);
  lines.push("");
  return lines.join("\n");
}

async function fingerprint(
  path: string,
  kind: EvidenceArtifact["kind"],
  directory: string,
): Promise<EvidenceArtifact> {
  const data = await readFile(path);
  return {
    kind,
    path: relative(directory, path).replaceAll("\\", "/"),
    bytes: data.byteLength,
    sha256: createHash("sha256").update(data).digest("hex"),
  };
}

function captureSelector(options: EvidenceBundleOptions): {
  marker?: string;
  atMs?: number;
} {
  if (options.atMarker !== undefined && options.atMs !== undefined) {
    throw new Error(
      "Evidence capture accepts either atMarker or atMs, not both.",
    );
  }
  return {
    ...(options.atMarker !== undefined ? { marker: options.atMarker } : {}),
    ...(options.atMs !== undefined ? { atMs: options.atMs } : {}),
  };
}

/** Resolve the screenshot source: explicit path wins, else derive from `recordingData`. */
function resolveScreenshotSource(options: EvidenceBundleOptions): string {
  if (options.screenshotPath) return resolve(options.screenshotPath);
  if (!options.recordingData) {
    throw new Error(
      "Evidence bundle needs either screenshotPath or recordingData.",
    );
  }
  const rec = options.recordingData;
  const frame =
    options.atMarker !== undefined
      ? frameAtMarker(rec, options.atMarker)
      : options.atMs !== undefined
        ? frameAt(rec, options.atMs)
        : finalFrame(rec);
  if (!frame)
    throw new Error(
      "recordingData has no sampled frames — start recording with sampleFps set.",
    );
  return frame.path;
}

export async function createEvidenceBundle(
  options: EvidenceBundleOptions,
): Promise<EvidenceBundle> {
  const screenshotPath = resolveScreenshotSource(options);
  const screenshotInfo = await stat(screenshotPath).catch(() => undefined);
  if (!screenshotInfo?.isFile())
    throw new Error(`Screenshot does not exist: ${screenshotPath}`);

  const directory = resolve(options.outputDirectory);
  await mkdir(directory, { recursive: true });

  const screenshot = join(directory, "screenshot.png");
  if (screenshot !== screenshotPath) await copyFile(screenshotPath, screenshot);

  let video: string | undefined;
  let preview: string | undefined;
  if (options.recordingData && options.recordingData.samples.length > 0) {
    video = join(directory, "demo.mp4");
    await exportVideoFromFrames(options.recordingData.samples, {
      format: "mp4",
      outPath: video,
      fps: options.fps ?? options.recordingData.sampleFps,
    });
  }
  if (video && (options.preview ?? true)) {
    preview = join(directory, "preview.gif");
    await createGifPreview(video, preview);
  }

  const title =
    markdownText(options.title ?? "Computer verification") ||
    "Computer verification";
  const summary = options.summary?.trim() ?? "";
  const prMarkdown = join(directory, "pr.md");
  const markdown = renderPullRequestMarkdown({
    result: options.result,
    title,
    summary,
    linkBase: normalizedLinkBase(options),
    hasVideo: video !== undefined,
    hasPreview: preview !== undefined,
  });
  await writeFile(prMarkdown, markdown);

  const artifacts = await Promise.all([
    fingerprint(screenshot, "screenshot", directory),
    ...(video ? [fingerprint(video, "video" as const, directory)] : []),
    ...(preview ? [fingerprint(preview, "preview" as const, directory)] : []),
    fingerprint(prMarkdown, "pr-markdown", directory),
  ]);

  const selector = captureSelector(options);
  const manifestData: EvidenceManifest = {
    version: 1,
    createdAt: new Date().toISOString(),
    result: options.result,
    title,
    summary,
    capture: {
      ...selector,
      final: selector.marker === undefined && selector.atMs === undefined,
    },
    artifacts,
  };
  const manifest = join(directory, "manifest.json");
  await writeFile(manifest, `${JSON.stringify(manifestData, null, 2)}\n`);

  return {
    directory,
    manifest,
    screenshot,
    ...(video ? { video } : {}),
    ...(preview ? { preview } : {}),
    prMarkdown,
  };
}
