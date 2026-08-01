/**
 * @nikcli-ai/browser-control
 *
 * Control, inspect, capture and test real web pages headlessly, in the
 * background — sibling to @nikcli-ai/terminal-control, but driving a
 * Playwright-backed Chromium page instead of a PTY.
 */
export * from "./frame"

export {
  BrowserSession,
  type KeyInput,
  type MouseButton,
  type PointerInput,
  type PointerModifier,
  type SessionInfo,
  type SessionOptions,
  type SendMode,
  type WaitCondition,
  type WaitResult,
  type SessionStatus,
} from "./session"
export { SessionManager } from "./manager"
export { translateKey, translateKeys } from "./keys"

export { Screencast, pngDimensions, type ScreencastFrame, type ScreencastOptions } from "./screencast"

export {
  Recorder,
  RECORDING_VERSION,
  duration,
  frameAt,
  finalFrame,
  frameAtMarker,
  type RecordingData,
  type RecordingMarker,
  type SampledFrame,
  type StartRecordingOptions,
} from "./recording"

export {
  renderText,
  renderJSON,
  toJSONFrame,
  renderPng,
  exportVideo,
  exportVideoFromFrames,
  createGifPreview,
  ffmpegAvailable,
  resolveFfmpegBinary,
  renderString,
  isBinaryFormat,
  type Format,
  type TextFormat,
  type JSONFrame,
  type VideoFormat,
  type ExportVideoOptions,
  type ExportVideoResult,
  type ExportFramesOptions,
  type ExportFramesResult,
} from "./render"

export {
  createEvidenceBundle,
  renderPullRequestMarkdown,
  type EvidenceArtifact,
  type EvidenceBundle,
  type EvidenceBundleOptions,
  type EvidenceManifest,
  type VerificationResult,
} from "./evidence"

// Background daemon — persists sessions across separate process invocations.
export {
  ensureDaemon,
  openScreencast,
  rpc,
  shutdownDaemon,
  socketPathFor,
  type OpenScreencastOptions,
  type ScreencastStreamFrame,
} from "./daemon-client"
export { startDaemon, type FrameMode } from "./daemon"
