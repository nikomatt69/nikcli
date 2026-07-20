/** Renderer dispatch — turn a {@link BrowserFrame} into any supported output format. */
import type { BrowserFrame } from "../frame"
import { renderText } from "./text"
import { renderJSON, toJSONFrame, type JSONFrame } from "./json"
import { renderPng } from "./png"
import {
  exportVideo,
  exportVideoFromFrames,
  createGifPreview,
  ffmpegAvailable,
  resolveFfmpegBinary,
  type VideoFormat,
  type ExportVideoOptions,
  type ExportVideoResult,
  type ExportFramesOptions,
  type ExportFramesResult,
} from "./video"

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
}
export type { JSONFrame, VideoFormat, ExportVideoOptions, ExportVideoResult, ExportFramesOptions, ExportFramesResult }

/** Text formats produce a string synchronously; `png` produces bytes synchronously too (already captured). */
export type TextFormat = "text" | "json"
export type Format = TextFormat | "png"

/** Render to any of the synchronous formats. */
export function renderString(frame: BrowserFrame, format: TextFormat): string {
  switch (format) {
    case "text":
      return renderText(frame)
    case "json":
      return renderJSON(frame)
  }
}

/** Whether a format yields binary (`png`) vs a string. */
export function isBinaryFormat(format: Format): format is "png" {
  return format === "png"
}
