/** Text rendering — a short, human-readable description of the frame. */
import type { ComputerFrame } from "../frame"

export function renderText(frame: ComputerFrame): string {
  const { mode, screen, capturedAt, screenshot } = frame
  const bytes = screenshot.length
  return [
    `mode: ${mode}`,
    `screen: ${screen.width}x${screen.height}`,
    `capturedAt: ${new Date(capturedAt).toISOString()}`,
    `screenshot: ${bytes} bytes of PNG`,
  ].join("\n")
}
