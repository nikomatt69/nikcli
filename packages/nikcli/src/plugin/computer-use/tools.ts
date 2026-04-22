// Computer-Use Tools - Tool definitions for nikcli
// Implements screenshot, click, type_text, and wait tools

import z from "zod"
import { Tool } from "@/tool/tool"
import { Identifier } from "@/id/id"
import {
  executeScreenshot,
  executeClick,
  executeTypeText,
  executeWait,
  PermissionRequiredError,
  resetState,
} from "./bridge"
import { checkPermissionStatus, getPermissionInstructions } from "./permissions"
import type { MessageV2 } from "@/session/message-v2"

const SCREENSHOT_DESCRIPTION = `Capture a macOS window screenshot with semantic targeting.

**Call this first** to choose a target window and get current UI state. Use optional parameters to specify which app or window to capture.

Returns a fresh screenshot with window-relative coordinates for use with the click tool.`

const CLICK_DESCRIPTION = `Click at coordinates in the current controlled window.

**Important**: Use coordinates from the latest screenshot. Coordinates are window-relative screenshot pixels (top-left origin, 0-based).

First call screenshot to establish the target window, then use coordinates from that screenshot for clicking. Returns a fresh screenshot after the click.`

const TYPE_TEXT_DESCRIPTION = `Type text into the focused element in the current controlled window.

Click a text field first to focus it, then call this tool to type text. The tool will attempt AX semantic text entry first, falling back to raw keyboard input if needed.

Returns a fresh screenshot after typing.`

const WAIT_DESCRIPTION = `Pause briefly and return a fresh screenshot of the current controlled window.

Use this for loading states, animations, or polling async UI updates. The optional ms parameter controls wait duration (default: ~1000ms, max: 60000ms).`

function makeAttachments(ctx: Tool.Context, pngBase64: string, captureId: string): MessageV2.FilePart[] {
  return [
    {
      id: Identifier.ascending("part"),
      sessionID: ctx.sessionID,
      messageID: ctx.messageID,
      type: "file",
      mime: "image/png",
      url: `data:image/png;base64,${pngBase64}`,
      filename: `screenshot-${captureId}.png`,
    },
  ]
}

export const ComputerUseScreenshotTool = Tool.define("computer-use-screenshot", {
  description: SCREENSHOT_DESCRIPTION,
  parameters: z.object({
    app: z.string().optional().describe("App name, e.g., 'Safari'. If not specified, captures the frontmost window."),
    windowTitle: z.string().optional().describe("Window title filter to narrow down the target."),
  }),
  async execute(args, ctx) {
    try {
      const result = await executeScreenshot({ app: args.app, windowTitle: args.windowTitle }, { abort: ctx.abort })
      // Extract captureId from the screenshot attachment URL
      const match = result.attachments?.[0]?.url.match(/screenshot-([^.]+)\.png$/)
      const captureId = match?.[1] ?? "unknown"

      return {
        title: result.title,
        output: result.output,
        metadata: result.metadata,
        attachments: makeAttachments(ctx, result.attachments?.[0]?.url.split(",")[1] ?? "", captureId),
      }
    } catch (error) {
      if (error instanceof PermissionRequiredError) {
        const instructions = getPermissionInstructions()
        throw new Error(`${error.message}\n\n${instructions}`)
      }
      throw error
    }
  },
})

export const ComputerUseClickTool = Tool.define("computer-use-click", {
  description: CLICK_DESCRIPTION,
  parameters: z.object({
    x: z.number().describe("X coordinate in screenshot pixels (window-relative, 0-based from left)."),
    y: z.number().describe("Y coordinate in screenshot pixels (window-relative, 0-based from top)."),
    captureId: z.string().optional().describe("Screenshot validation ID. If stale, refresh with screenshot."),
  }),
  async execute(args, ctx) {
    try {
      const result = await executeClick({ x: args.x, y: args.y, captureId: args.captureId }, { abort: ctx.abort })
      const match = result.attachments?.[0]?.url.match(/screenshot-([^.]+)\.png$/)
      const captureId = match?.[1] ?? "unknown"

      return {
        title: result.title,
        output: result.output,
        metadata: result.metadata,
        attachments: makeAttachments(ctx, result.attachments?.[0]?.url.split(",")[1] ?? "", captureId),
      }
    } catch (error) {
      if (error instanceof PermissionRequiredError) {
        const instructions = getPermissionInstructions()
        throw new Error(`${error.message}\n\n${instructions}`)
      }
      throw error
    }
  },
})

export const ComputerUseTypeTool = Tool.define("computer-use-type", {
  description: TYPE_TEXT_DESCRIPTION,
  parameters: z.object({
    text: z.string().describe("Text to type into the focused element."),
  }),
  async execute(args, ctx) {
    try {
      const result = await executeTypeText({ text: args.text }, { abort: ctx.abort })
      const match = result.attachments?.[0]?.url.match(/screenshot-([^.]+)\.png$/)
      const captureId = match?.[1] ?? "unknown"

      return {
        title: result.title,
        output: result.output,
        metadata: result.metadata,
        attachments: makeAttachments(ctx, result.attachments?.[0]?.url.split(",")[1] ?? "", captureId),
      }
    } catch (error) {
      if (error instanceof PermissionRequiredError) {
        const instructions = getPermissionInstructions()
        throw new Error(`${error.message}\n\n${instructions}`)
      }
      throw error
    }
  },
})

export const ComputerUseWaitTool = Tool.define("computer-use-wait", {
  description: WAIT_DESCRIPTION,
  parameters: z.object({
    ms: z.number().optional().describe("Milliseconds to wait. Default ~1000ms, max 60000ms."),
  }),
  async execute(args, ctx) {
    try {
      const result = await executeWait({ ms: args.ms }, { abort: ctx.abort })
      const match = result.attachments?.[0]?.url.match(/screenshot-([^.]+)\.png$/)
      const captureId = match?.[1] ?? "unknown"

      return {
        title: result.title,
        output: result.output,
        metadata: result.metadata,
        attachments: makeAttachments(ctx, result.attachments?.[0]?.url.split(",")[1] ?? "", captureId),
      }
    } catch (error) {
      if (error instanceof PermissionRequiredError) {
        const instructions = getPermissionInstructions()
        throw new Error(`${error.message}\n\n${instructions}`)
      }
      throw error
    }
  },
})

// Export all tools as an array
export const COMPUTER_USE_TOOLS = [
  ComputerUseScreenshotTool,
  ComputerUseClickTool,
  ComputerUseTypeTool,
  ComputerUseWaitTool,
]

// Re-export helper for permission checking
export { resetState }

// Permission status check
export async function getComputerUseStatus() {
  try {
    const status = await checkPermissionStatus()
    return {
      ready: status.ready,
      accessibility: status.status.accessibility,
      screenRecording: status.status.screenRecording,
      missing: status.missing,
    }
  } catch {
    return {
      ready: false,
      accessibility: false,
      screenRecording: false,
      missing: ["accessibility", "screenRecording"] as const,
    }
  }
}
