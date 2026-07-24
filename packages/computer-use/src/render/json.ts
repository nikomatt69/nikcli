/** JSON rendering of a {@link ComputerFrame}, screenshot bytes base64-encoded for portability. */
import type { ComputerFrame } from "../frame";

export interface JSONFrame {
  readonly mode: "sandbox" | "host";
  readonly screen: { readonly width: number; readonly height: number };
  readonly capturedAt: number;
  readonly screenshotBase64: string;
}

export function toJSONFrame(frame: ComputerFrame): JSONFrame {
  return {
    mode: frame.mode,
    screen: frame.screen,
    capturedAt: frame.capturedAt,
    screenshotBase64: Buffer.from(frame.screenshot).toString("base64"),
  };
}

export function renderJSON(frame: ComputerFrame): string {
  return JSON.stringify(toJSONFrame(frame), null, 2);
}
