/** PNG rendering — a desktop screenshot is already a PNG, so this is a typed passthrough. */
import type { ComputerFrame } from "../frame";

export function renderPng(frame: ComputerFrame): Uint8Array {
  return frame.screenshot;
}
