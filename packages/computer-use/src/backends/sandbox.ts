/**
 * Sandbox backend — drives an isolated background Linux desktop container for
 * the given conversation, the way `@nikcli-ai/browser-control`'s Playwright
 * sandbox keeps one Chromium per session. The container lifecycle is owned by
 * the per-process `Sandbox` registry; this module adapts the host-side
 * `Backend` contract onto `docker exec ... DISPLAY=:99 <xdotool|scrot>`.
 */
import { Sandbox } from "../sandbox";
import { SandboxImage } from "../sandbox-image";
import type { Backend, Capabilities, MouseButton, Point } from "./host";

function btnCode(button: MouseButton): string {
  return button === "right" ? "3" : button === "middle" ? "2" : "1";
}

/** Translate a friendly key/chord into xdotool keysym notation. */
function xdotoolKey(combo: string): string {
  const map: Record<string, string> = {
    cmd: "super",
    command: "super",
    ctrl: "ctrl",
    control: "ctrl",
    alt: "alt",
    option: "alt",
    shift: "shift",
    enter: "Return",
    return: "Return",
    esc: "Escape",
    escape: "Escape",
    space: "space",
    tab: "Tab",
    backspace: "BackSpace",
    delete: "Delete",
    up: "Up",
    down: "Down",
    left: "Left",
    right: "Right",
    arrowup: "Up",
    arrowdown: "Down",
    arrowleft: "Left",
    arrowright: "Right",
    home: "Home",
    end: "End",
    pageup: "Prior",
    pagedown: "Next",
  };
  return combo
    .trim()
    .split("+")
    .map((part) => {
      const key = part.trim();
      return map[key.toLowerCase()] ?? key;
    })
    .join("+");
}

async function sandboxRun(sessionID: string, args: string[]): Promise<void> {
  const { code, stderr } = await Sandbox.exec(sessionID, args);
  if (code !== 0)
    throw new Error(
      `${args[0]} failed in sandbox: ${stderr.trim() || `exit ${code}`}`,
    );
}

/** Drives an isolated background desktop container for this conversation. */
export function sandboxBackend(sessionID: string): Backend {
  return {
    mode: "sandbox" as const,
    async capabilities(): Promise<Capabilities> {
      const { desktop } = await Sandbox.status(sessionID);
      return {
        platform: "linux",
        screenshot: true,
        input: true,
        detail: desktop
          ? `background sandbox desktop (${desktop.width}x${desktop.height}) · live preview: ${desktop.liveUrl}`
          : "background sandbox desktop (starts on first action)",
      };
    },
    async screenshot(): Promise<Uint8Array> {
      const { code, stdout, stderr } = await Sandbox.exec(sessionID, [
        "sh",
        "-c",
        "scrot -o /tmp/nikcli-shot.png >/dev/null 2>&1 && cat /tmp/nikcli-shot.png",
      ]);
      if (code !== 0 || stdout.length === 0)
        throw new Error(
          `sandbox screenshot failed: ${stderr.trim() || "no image output"}`,
        );
      return new Uint8Array(stdout);
    },
    async screenSize(): Promise<{ width: number; height: number }> {
      const { code, stdout } = await Sandbox.exec(sessionID, [
        "xdotool",
        "getdisplaygeometry",
      ]);
      if (code === 0) {
        const [w, h] = stdout
          .toString()
          .trim()
          .split(/\s+/)
          .map((value) => parseInt(value, 10));
        if (w && h) return { width: w, height: h };
      }
      const desktop = Sandbox.local(sessionID);
      return {
        width: desktop?.width ?? SandboxImage.DEFAULT_WIDTH,
        height: desktop?.height ?? SandboxImage.DEFAULT_HEIGHT,
      };
    },
    async moveMouse(point: Point): Promise<void> {
      await sandboxRun(sessionID, [
        "xdotool",
        "mousemove",
        String(Math.round(point.x)),
        String(Math.round(point.y)),
      ]);
    },
    async click(
      point: Point | undefined,
      button: MouseButton = "left",
      double = false,
    ): Promise<void> {
      if (point) await this.moveMouse(point);
      await sandboxRun(sessionID, [
        "xdotool",
        "click",
        ...(double ? ["--repeat", "2"] : []),
        btnCode(button),
      ]);
    },
    async drag(from: Point, to: Point): Promise<void> {
      await sandboxRun(sessionID, [
        "xdotool",
        "mousemove",
        String(Math.round(from.x)),
        String(Math.round(from.y)),
        "mousedown",
        "1",
        "mousemove",
        String(Math.round(to.x)),
        String(Math.round(to.y)),
        "mouseup",
        "1",
      ]);
    },
    async type(text: string): Promise<void> {
      await sandboxRun(sessionID, [
        "xdotool",
        "type",
        "--clearmodifiers",
        "--",
        text,
      ]);
    },
    async key(combo: string): Promise<void> {
      await sandboxRun(sessionID, [
        "xdotool",
        "key",
        "--clearmodifiers",
        xdotoolKey(combo),
      ]);
    },
    async scroll(
      point: Point | undefined,
      direction: "up" | "down" | "left" | "right",
      amount = 3,
    ): Promise<void> {
      if (point) await this.moveMouse(point);
      const btn =
        direction === "up"
          ? "4"
          : direction === "down"
            ? "5"
            : direction === "left"
              ? "6"
              : "7";
      await sandboxRun(sessionID, [
        "xdotool",
        "click",
        "--repeat",
        String(amount),
        btn,
      ]);
    },
  };
}
