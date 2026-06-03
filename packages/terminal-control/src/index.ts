/**
 * @nikcli-ai/terminal-control
 *
 * A custom-built terminal-control engine for nikcli: drive, inspect, capture and
 * test real terminal applications (TUIs). Spawn a PTY-backed program, parse its
 * ANSI/VT output into a screen grid (a {@link Frame}), and render that frame to
 * text, ANSI, JSON, SVG or PNG.
 */
export * from "./frame"
export { Screen } from "./vt/screen"
export { Parser, type ParserSink } from "./vt/parser"
export { applySGR } from "./vt/sgr"
export { resolveColor, indexedToRGB, rgbToHex, type RGB, type ResolveOptions } from "./vt/color"

export {
  Session,
  type SessionInfo,
  type SessionOptions,
  type SendMode,
  type WaitCondition,
  type WaitResult,
  type SessionStatus,
} from "./session"
export { SessionManager } from "./manager"
export { translateKey, translateKeys } from "./keys"

export {
  Recorder,
  RECORDING_VERSION,
  duration,
  frameAt,
  finalFrame,
  sampleFrames,
  clip,
  clipBetweenMarkers,
  toAsciicast,
  fromJSON,
  type RecordingData,
  type RecordingEvent,
  type RecordingMarker,
  type RecordingMeta,
  type SampleOptions,
  type SampledFrame,
} from "./recording"

export {
  renderText,
  renderAnsi,
  renderJSON,
  toJSONFrame,
  renderSvg,
  svgLayers,
  svgGeometry,
  renderPng,
  renderAnimatedSvg,
  renderPngSequence,
  exportVideo,
  ffmpegAvailable,
  renderString,
  isBinaryFormat,
  type Format,
  type TextFormat,
  type TextOptions,
  type AnsiOptions,
  type SvgOptions,
  type PngOptions,
  type JSONFrame,
  type AnimatedSvgOptions,
  type PngFrame,
  type VideoFormat,
  type ExportVideoOptions,
  type ExportVideoResult,
} from "./render"
