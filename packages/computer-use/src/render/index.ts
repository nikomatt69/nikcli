/** Renderer dispatch — turn a {@link ComputerFrame} into any supported output format. */
import type { ComputerFrame } from "../frame";
import { renderText } from "./text";
import { renderJSON, toJSONFrame, type JSONFrame } from "./json";
import { renderPng } from "./png";
import {
  exportVideoFromFrames,
  createGifPreview,
  ffmpegAvailable,
  resolveFfmpegBinary,
  type ExportFramesOptions,
  type ExportFramesResult,
  type ExportVideoOptions,
  type ExportVideoResult,
  type VideoFormat,
} from "./video";

export {
  renderText,
  renderJSON,
  toJSONFrame,
  renderPng,
  exportVideoFromFrames,
  createGifPreview,
  ffmpegAvailable,
  resolveFfmpegBinary,
};
export type {
  JSONFrame,
  VideoFormat,
  ExportVideoOptions,
  ExportVideoResult,
  ExportFramesOptions,
  ExportFramesResult,
};

/** Text formats produce a string synchronously; `png` produces bytes synchronously (already captured). */
export type TextFormat = "text" | "json";
export type Format = TextFormat | "png";

/** Render to any of the synchronous formats. */
export function renderString(frame: ComputerFrame, format: TextFormat): string {
  switch (format) {
    case "text":
      return renderText(frame);
    case "json":
      return renderJSON(frame);
  }
}

/** Whether a format yields binary (`png`) vs a string. */
export function isBinaryFormat(format: Format): format is "png" {
  return format === "png";
}
