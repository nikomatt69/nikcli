import z from "zod";
import { Tool } from "./tool";
import DESCRIPTION from "./computer.txt";
import { Sandbox } from "../computer/computer";
import type {
  Backend,
  Capabilities,
  Mode,
  Point,
} from "@nikcli-ai/computer-use";
import { backend, hostBackend } from "@nikcli-ai/computer-use";
import { Identifier } from "../id/id";
import type { MessageV2 } from "../session/message-v2";
import { Config } from "@/config/config";
import { runPromiseWithLayer, withCurrentInstance } from "@/effect";
import { Effect } from "effect";

const ACTIONS = [
  "screenshot",
  "capabilities",
  "screen_size",
  "mouse_move",
  "left_click",
  "right_click",
  "middle_click",
  "double_click",
  "left_click_drag",
  "type",
  "key",
  "scroll",
  "status",
  "stop",
] as const;

const parameters = z.object({
  action: z.enum(ACTIONS).describe("The computer action to perform"),
  x: z.number().optional().describe("Screen X coordinate (pixels from left)"),
  y: z.number().optional().describe("Screen Y coordinate (pixels from top)"),
  to_x: z
    .number()
    .optional()
    .describe("Destination X coordinate (for left_click_drag)"),
  to_y: z
    .number()
    .optional()
    .describe("Destination Y coordinate (for left_click_drag)"),
  text: z
    .string()
    .optional()
    .describe("Text to type, or key/chord to press (for `type`/`key`)"),
  direction: z
    .enum(["up", "down", "left", "right"])
    .optional()
    .describe("Scroll direction"),
  amount: z
    .number()
    .optional()
    .describe("Scroll amount in notches (default 3)"),
});

type Params = z.infer<typeof parameters>;

function imageAttachment(
  ctx: Tool.Context,
  base64: string,
): MessageV2.FilePart {
  return {
    id: Identifier.ascending("part"),
    sessionID: ctx.sessionID,
    messageID: ctx.messageID,
    type: "file",
    mime: "image/png",
    url: `data:image/png;base64,${base64}`,
    filename: "screen.png",
  };
}

function requirePoint(params: Params): Point | undefined {
  if (typeof params.x === "number" && typeof params.y === "number")
    return { x: params.x, y: params.y };
  return undefined;
}

function loadConfig() {
  return runPromiseWithLayer(
    Config.defaultLayer,
    withCurrentInstance(
      Effect.gen(function* () {
        const config = yield* Config.Service;
        const value = yield* config.get();
        return value.computer;
      }),
    ),
  );
}

/** Live preview URL for the conversation's sandbox desktop, if any. */
function liveUrl(mode: Mode, sessionID: string): string | undefined {
  return mode === "sandbox" ? Sandbox.local(sessionID)?.liveUrl : undefined;
}

export const ComputerTool = Tool.define("computer", {
  description: DESCRIPTION,
  parameters,
  async execute(params, ctx): Promise<Tool.Result> {
    const cfg = await loadConfig();
    const mode: Mode = cfg?.mode ?? "sandbox";
    const driver: Backend = backend(mode, ctx.sessionID);

    await ctx.ask({
      permission: "computer",
      patterns: [params.action],
      always: ["*"],
      metadata: { action: params.action, mode, x: params.x, y: params.y },
    });

    function base(extra?: Record<string, unknown>) {
      return {
        action: params.action,
        mode,
        liveUrl: liveUrl(mode, ctx.sessionID),
        ...extra,
      };
    }

    // Surface the live preview as soon as we touch the sandbox so the workbench
    // can show what the background desktop is doing.
    if (mode === "sandbox" && params.action !== "stop") {
      ctx.metadata({
        title:
          params.action === "status"
            ? "computer · status"
            : "Computer use (background)",
        metadata: base(),
      });
    }

    switch (params.action) {
      case "status": {
        if (mode === "host") {
          const cap: Capabilities = await hostBackend.capabilities();
          return {
            title: "computer · status",
            output: `mode: host (drives your real screen)\nplatform: ${cap.platform}\n${cap.detail}`,
            metadata: base({ running: true, ...cap }),
          };
        }
        const state = await Sandbox.status(ctx.sessionID);
        return {
          title: "computer · status",
          output: state.desktop
            ? `mode: sandbox (background)\nrunning: ${state.running}\nlive preview: ${state.desktop.liveUrl}\nsize: ${state.desktop.width}x${state.desktop.height}`
            : "mode: sandbox (background)\nNo desktop has been started for this conversation yet.",
          metadata: base({ running: state.running }),
        };
      }

      case "stop": {
        if (mode === "host") {
          return {
            title: "computer · stop",
            output: "Host mode has no background session to stop.",
            metadata: base(),
          };
        }
        const stopped = await Sandbox.close(ctx.sessionID);
        return {
          title: "computer · stop",
          output: stopped
            ? "Background computer desktop stopped."
            : "No background computer desktop to stop.",
          metadata: {
            action: params.action,
            mode,
            status: stopped ? "stopped" : "not_started",
          },
        };
      }

      case "capabilities": {
        const cap: Capabilities = await driver.capabilities();
        return {
          title: "computer capabilities",
          output: `mode: ${mode}\nplatform: ${cap.platform}\nscreenshot: ${cap.screenshot}\ninput: ${cap.input}\n${cap.detail}`,
          metadata: base({ ...cap }),
        };
      }

      case "screen_size": {
        const size = await driver.screenSize();
        return {
          title: "computer screen size",
          output: `Screen size: ${size.width}x${size.height}`,
          metadata: base(size),
        };
      }

      case "screenshot": {
        const bytes = await driver.screenshot();
        const data = Buffer.from(bytes).toString("base64");
        return {
          title: "computer screenshot",
          output:
            mode === "sandbox"
              ? "Captured the background desktop."
              : "Captured screen.",
          metadata: base(),
          attachments: [imageAttachment(ctx, data)],
        };
      }

      case "mouse_move": {
        const point = requirePoint(params);
        if (!point) throw new Error("`mouse_move` requires `x` and `y`");
        await driver.moveMouse(point);
        return {
          title: "computer mouse_move",
          output: `Moved to (${point.x}, ${point.y})`,
          metadata: base(point),
        };
      }

      case "left_click":
      case "right_click":
      case "middle_click":
      case "double_click": {
        const button =
          params.action === "right_click"
            ? "right"
            : params.action === "middle_click"
              ? "middle"
              : "left";
        const double = params.action === "double_click";
        const point = requirePoint(params);
        await driver.click(point, button, double);
        return {
          title: `computer ${params.action}`,
          output: point
            ? `${params.action} at (${point.x}, ${point.y})`
            : `${params.action} at current position`,
          metadata: base({ x: point?.x, y: point?.y }),
        };
      }

      case "left_click_drag": {
        const from = requirePoint(params);
        if (
          !from ||
          typeof params.to_x !== "number" ||
          typeof params.to_y !== "number"
        ) {
          throw new Error(
            "`left_click_drag` requires `x`, `y`, `to_x`, and `to_y`",
          );
        }
        const to = { x: params.to_x, y: params.to_y };
        await driver.drag(from, to);
        return {
          title: "computer left_click_drag",
          output: `Dragged from (${from.x}, ${from.y}) to (${to.x}, ${to.y})`,
          metadata: base({ from, to }),
        };
      }

      case "type": {
        if (params.text === undefined)
          throw new Error("`type` requires `text`");
        await driver.type(params.text);
        return {
          title: "computer type",
          output: `Typed ${params.text.length} character(s)`,
          metadata: base(),
        };
      }

      case "key": {
        if (!params.text)
          throw new Error("`key` requires `text` (the key or chord to press)");
        await driver.key(params.text);
        return {
          title: `computer key ${params.text}`,
          output: `Pressed ${params.text}`,
          metadata: base({ key: params.text }),
        };
      }

      case "scroll": {
        const point = requirePoint(params);
        await driver.scroll(
          point,
          params.direction ?? "down",
          params.amount ?? 3,
        );
        return {
          title: "computer scroll",
          output: `Scrolled ${params.direction ?? "down"}`,
          metadata: base({
            direction: params.direction ?? "down",
            amount: params.amount ?? 3,
          }),
        };
      }

      default: {
        const _exhaustive: never = params.action;
        throw new Error(
          `Unsupported computer action: ${_exhaustive as string}`,
        );
      }
    }
  },
});
