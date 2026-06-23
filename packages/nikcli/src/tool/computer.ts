import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./computer.txt"
import { Computer } from "../computer/computer"
import { Identifier } from "../id/id"
import type { MessageV2 } from "../session/message-v2"

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
] as const

const parameters = z.object({
  action: z.enum(ACTIONS).describe("The computer action to perform"),
  x: z.number().optional().describe("Screen X coordinate (pixels from left)"),
  y: z.number().optional().describe("Screen Y coordinate (pixels from top)"),
  to_x: z.number().optional().describe("Destination X coordinate (for left_click_drag)"),
  to_y: z.number().optional().describe("Destination Y coordinate (for left_click_drag)"),
  text: z.string().optional().describe("Text to type, or key/chord to press (for `type`/`key`)"),
  direction: z.enum(["up", "down", "left", "right"]).optional().describe("Scroll direction"),
  amount: z.number().optional().describe("Scroll amount in notches (default 3)"),
})

function imageAttachment(ctx: Tool.Context, base64: string): MessageV2.FilePart {
  return {
    id: Identifier.ascending("part"),
    sessionID: ctx.sessionID,
    messageID: ctx.messageID,
    type: "file",
    mime: "image/png",
    url: `data:image/png;base64,${base64}`,
    filename: "screen.png",
  }
}

function requirePoint(params: z.infer<typeof parameters>): Computer.Point | undefined {
  if (typeof params.x === "number" && typeof params.y === "number") return { x: params.x, y: params.y }
  return undefined
}

export const ComputerTool = Tool.define("computer", {
  description: DESCRIPTION,
  parameters,
  async execute(params, ctx): Promise<Tool.Result> {
    await ctx.ask({
      permission: "computer",
      patterns: [params.action],
      always: ["*"],
      metadata: { action: params.action, x: params.x, y: params.y },
    })

    switch (params.action) {
      case "capabilities": {
        const cap = await Computer.capabilities()
        return {
          title: "computer capabilities",
          output: `platform: ${cap.platform}\nscreenshot: ${cap.screenshot}\ninput: ${cap.input}\n${cap.detail}`,
          metadata: { action: "capabilities", ...cap },
        }
      }

      case "screen_size": {
        const size = await Computer.screenSize()
        return {
          title: "computer screen size",
          output: `Screen size: ${size.width}x${size.height}`,
          metadata: { action: "screen_size", ...size },
        }
      }

      case "screenshot": {
        const data = await Computer.screenshot()
        return {
          title: "computer screenshot",
          output: "Captured screen.",
          metadata: { action: "screenshot" },
          attachments: [imageAttachment(ctx, data)],
        }
      }

      case "mouse_move": {
        const point = requirePoint(params)
        if (!point) throw new Error("`mouse_move` requires `x` and `y`")
        await Computer.moveMouse(point)
        return {
          title: "computer mouse_move",
          output: `Moved to (${point.x}, ${point.y})`,
          metadata: { action: "mouse_move", ...point },
        }
      }

      case "left_click":
      case "right_click":
      case "middle_click":
      case "double_click": {
        const button = params.action === "right_click" ? "right" : params.action === "middle_click" ? "middle" : "left"
        const double = params.action === "double_click"
        const point = requirePoint(params)
        await Computer.click(point, button, double)
        return {
          title: `computer ${params.action}`,
          output: point ? `${params.action} at (${point.x}, ${point.y})` : `${params.action} at current position`,
          metadata: { action: params.action, x: point?.x, y: point?.y },
        }
      }

      case "left_click_drag": {
        const from = requirePoint(params)
        if (!from || typeof params.to_x !== "number" || typeof params.to_y !== "number") {
          throw new Error("`left_click_drag` requires `x`, `y`, `to_x`, and `to_y`")
        }
        const to = { x: params.to_x, y: params.to_y }
        await Computer.drag(from, to)
        return {
          title: "computer left_click_drag",
          output: `Dragged from (${from.x}, ${from.y}) to (${to.x}, ${to.y})`,
          metadata: { action: "left_click_drag", from, to },
        }
      }

      case "type": {
        if (params.text === undefined) throw new Error("`type` requires `text`")
        await Computer.type(params.text)
        return {
          title: "computer type",
          output: `Typed ${params.text.length} character(s)`,
          metadata: { action: "type" },
        }
      }

      case "key": {
        if (!params.text) throw new Error("`key` requires `text` (the key or chord to press)")
        await Computer.key(params.text)
        return {
          title: `computer key ${params.text}`,
          output: `Pressed ${params.text}`,
          metadata: { action: "key", key: params.text },
        }
      }

      case "scroll": {
        const point = requirePoint(params)
        await Computer.scroll(point, params.direction ?? "down", params.amount ?? 3)
        return {
          title: "computer scroll",
          output: `Scrolled ${params.direction ?? "down"}`,
          metadata: {
            action: "scroll",
            direction: params.direction ?? "down",
            amount: params.amount ?? 3,
          },
        }
      }

      default: {
        const _exhaustive: never = params.action
        throw new Error(`Unsupported computer action: ${_exhaustive as string}`)
      }
    }
  },
})
