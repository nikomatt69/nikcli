/**
 * @nikcli-ai/computer-use
 *
 * Control, inspect, capture and test real desktop sessions through a
 * background per-workspace daemon, the way `@nikcli-ai/browser-control`
 * drives a headless Chromium page or `@nikcli-ai/terminal-control` drives
 * a PTY-backed TUI. One or more named desktop sessions, each backed by a
 * Docker-managed Linux desktop in the default `sandbox` mode (an isolated
 * noVNC-served background VM) or by the user's real desktop in opt-in
 * `host` mode. Drive them with mouse / keyboard actions, capture
 * screenshots, record markers, and produce a PR-ready evidence bundle.
 */
export * from "./frame";
export * from "./backends";
export {
  ComputerSession,
  type SessionInfo,
  type SessionOptions,
  type SessionStatus,
  type SendMode,
  type WaitCondition,
  type WaitResult,
} from "./session";
export { SessionManager } from "./manager";
export { translateKey, translateKeys } from "./keys";

export {
  Recorder,
  RECORDING_VERSION,
  duration,
  frameAt,
  finalFrame,
  frameAtMarker,
  loadFrame,
  type RecordingData,
  type RecordingMarker,
  type SampledFrame,
  type StartRecordingOptions,
} from "./recording";

export {
  renderText,
  renderJSON,
  toJSONFrame,
  renderPng,
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
} from "./render";

export {
  createEvidenceBundle,
  renderPullRequestMarkdown,
  type EvidenceArtifact,
  type EvidenceBundle,
  type EvidenceBundleOptions,
  type EvidenceManifest,
  type VerificationResult,
} from "./evidence";

// Background daemon — persists sessions across separate process invocations.
export {
  ensureDaemon,
  rpc,
  shutdownDaemon,
  socketPathFor,
} from "./daemon-client";
export { startDaemon } from "./daemon";

// Container registry (used by the sandbox backend; exposed for advanced use).
export { Sandbox } from "./sandbox";
export { SandboxImage } from "./sandbox-image";
