import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./browser-control.txt"
import { Identifier } from "@nikcli-ai/util/id"
import type { MessageV2 } from "../session/message-v2"
import { BrowserControl } from "../browser-control/browser-control"
import { rpc } from "@nikcli-ai/browser-control"
import type { JSONFrame, SessionInfo } from "@nikcli-ai/browser-control"

const ACTIONS = [
  "start",
  "goto",
  "click",
  "fill",
  "hover",
  "scroll",
  "send",
  "wait",
  "snapshot",
  "resize",
  "list",
  "info",
  "stop",
  "remove",
  "restart",
  "start_recording",
  "marker",
  "stop_recording",
  "recording_data",
  "video_path",
  "close_all",
] as const

const parameters = z
  .object({
    action: z.enum(ACTIONS).describe("The browser-control operation to perform"),
    name: z.string().optional().describe("Session name; defaults to one session per conversation"),
    url: z.string().optional().describe("For start/goto"),
    viewport: z
      .string()
      .regex(/^\d+x\d+$/)
      .optional()
      .describe("WIDTHxHEIGHT, e.g. 1280x800 (for start/resize)"),
    record: z.boolean().optional().describe("For start: capture a full-session webm video"),
    selector: z.string().optional().describe("For click/fill/hover/wait(selector)"),
    value: z.string().optional().describe("For fill"),
    dx: z.number().optional().describe("For scroll"),
    dy: z.number().optional().describe("For scroll"),
    mode: z.enum(["text", "keys"]).optional().describe("For send"),
    input: z.string().optional().describe("For send: text to type, or space-separated key tokens"),
    wait_for: z.enum(["text", "selector", "idle", "stable", "timeout"]).optional().describe("For wait"),
    text: z.string().optional().describe("For wait(text)"),
    state: z.enum(["attached", "detached", "visible", "hidden"]).optional().describe("For wait(selector)"),
    stable_ms: z.number().optional().describe("For wait(stable): quiet period required, default 500ms"),
    timeout_ms: z.number().optional().describe("For wait"),
    width: z.number().optional().describe("For resize (alternative to viewport)"),
    height: z.number().optional().describe("For resize (alternative to viewport)"),
    format: z.enum(["png", "text", "json"]).optional().default("png").describe("For snapshot"),
    marker_name: z.string().optional().describe("For marker"),
    sample_fps: z
      .number()
      .optional()
      .describe(
        "For start_recording: periodic real-screenshot rate, usable for video/frame lookup while the session is still running",
      ),
  })
  .superRefine((input, ctx) => {
    if (input.action === "goto" && !input.url) {
      ctx.addIssue({ code: "custom", path: ["url"], message: "url is required for action=goto" })
    }
    if ((input.action === "click" || input.action === "hover") && !input.selector) {
      ctx.addIssue({ code: "custom", path: ["selector"], message: `selector is required for action=${input.action}` })
    }
    if (input.action === "fill" && (!input.selector || input.value === undefined)) {
      ctx.addIssue({ code: "custom", path: ["selector"], message: "selector and value are required for action=fill" })
    }
    if (input.action === "send" && (!input.mode || input.input === undefined)) {
      ctx.addIssue({ code: "custom", path: ["mode"], message: "mode and input are required for action=send" })
    }
    if (input.action === "wait" && !input.wait_for) {
      ctx.addIssue({ code: "custom", path: ["wait_for"], message: "wait_for is required for action=wait" })
    }
    if (input.action === "marker" && !input.marker_name) {
      ctx.addIssue({ code: "custom", path: ["marker_name"], message: "marker_name is required for action=marker" })
    }
    if (
      (input.action === "list" || input.action === "close_all") &&
      input.name !== undefined &&
      input.name.length === 0
    ) {
      ctx.addIssue({ code: "custom", path: ["name"], message: "name must not be empty" })
    }
  })

type Params = z.infer<typeof parameters>

type Metadata = {
  surface: "browser_control"
  action: string
  name?: string
}

function parseViewport(value: string): { width: number; height: number } {
  const [w, h] = value.split("x")
  return { width: Number(w), height: Number(h) }
}

function waitCondition(params: Params): Record<string, unknown> {
  switch (params.wait_for) {
    case "text":
      return { type: "text", value: params.text, ...(params.timeout_ms ? { timeout: params.timeout_ms } : undefined) }
    case "selector":
      return {
        type: "selector",
        value: params.selector,
        ...(params.state ? { state: params.state } : undefined),
        ...(params.timeout_ms ? { timeout: params.timeout_ms } : undefined),
      }
    case "idle":
      return { type: "idle", ...(params.timeout_ms ? { timeout: params.timeout_ms } : undefined) }
    case "stable":
      return {
        type: "stable",
        ...(params.stable_ms ? { ms: params.stable_ms } : undefined),
        ...(params.timeout_ms ? { timeout: params.timeout_ms } : undefined),
      }
    default:
      return { type: "timeout", ms: params.timeout_ms ?? 1000 }
  }
}

// T3: the success codec.
//
// `browser_control` is one tool with twenty-one actions and heterogeneous
// results, so the codec is a union discriminated on the action the caller
// asked for. Every branch carries the action back, which is what lets a machine
// consumer switch on the result instead of parsing a string.
//
// Payloads that come from the daemon are declared with `z.looseObject`: this
// validates the fields the tool documents and passes the rest through, so a new
// field on the other side of the socket cannot fail a call that would otherwise
// have worked. Validating externally-produced payloads strictly is how a codec
// turns into an outage.
const SessionSnapshot = z.looseObject({
  name: z.string(),
  url: z.string(),
  viewport: z.looseObject({ width: z.number(), height: z.number() }),
  status: z.string(),
  createdAt: z.number(),
  recording: z.boolean(),
})

const FrameSnapshot = z.looseObject({
  url: z.string(),
  title: z.string(),
  viewport: z.looseObject({ width: z.number(), height: z.number() }),
  text: z.string(),
})

const SESSION_RESULT = { name: z.string(), session: SessionSnapshot }

// Written out per action rather than through a helper: the union is the
// contract, and a reader should be able to see each action's result without
// resolving a generic.
const output = z.discriminatedUnion("action", [
  z.object({ action: z.literal("close_all"), closed: z.literal(true) }),
  z.object({ action: z.literal("list"), sessions: z.array(SessionSnapshot) }),
  z.object({ action: z.literal("start"), ...SESSION_RESULT }),
  z.object({ action: z.literal("info"), ...SESSION_RESULT }),
  z.object({ action: z.literal("goto"), ...SESSION_RESULT }),
  z.object({ action: z.literal("resize"), ...SESSION_RESULT }),
  z.object({ action: z.literal("restart"), ...SESSION_RESULT }),
  z.object({ action: z.literal("click"), name: z.string(), selector: z.string() }),
  z.object({ action: z.literal("fill"), name: z.string(), selector: z.string() }),
  z.object({ action: z.literal("hover"), name: z.string(), selector: z.string() }),
  z.object({ action: z.literal("scroll"), name: z.string(), dx: z.number(), dy: z.number() }),
  z.object({ action: z.literal("send"), name: z.string(), mode: z.string() }),
  z.object({ action: z.literal("wait"), name: z.string(), result: z.unknown() }),
  z.object({
    action: z.literal("snapshot"),
    name: z.string(),
    format: z.enum(["png", "text", "json"]),
    frame: FrameSnapshot.optional(),
    text: z.string().optional(),
  }),
  z.object({ action: z.literal("stop"), name: z.string(), stopped: z.literal(true) }),
  z.object({ action: z.literal("remove"), name: z.string(), removed: z.literal(true) }),
  z.object({
    action: z.literal("start_recording"),
    name: z.string(),
    recording: z.literal(true),
    sampleFps: z.number().optional(),
  }),
  z.object({ action: z.literal("marker"), name: z.string(), marker: z.unknown() }),
  z.object({ action: z.literal("stop_recording"), name: z.string(), recording: z.unknown() }),
  z.object({ action: z.literal("recording_data"), name: z.string(), recording: z.unknown() }),
  z.object({ action: z.literal("video_path"), name: z.string(), path: z.string().nullable() }),
])

function startedRecording(name: string, sampleFps: number | undefined) {
  const value = { action: "start_recording" as const, name, recording: true as const }
  if (sampleFps === undefined) return value
  return { ...value, sampleFps }
}

function imageAttachment(ctx: Tool.Context, base64: string): MessageV2.FilePart {
  return {
    id: Identifier.ascending("part"),
    sessionID: ctx.sessionID,
    messageID: ctx.messageID,
    type: "file",
    mime: "image/png",
    url: `data:image/png;base64,${base64}`,
    filename: "browser.png",
  }
}

function baseMetadata(action: string, name?: string): Metadata {
  return { surface: "browser_control", action, name }
}

/** Auto-start a blank session under `name` if one isn't already running, so most actions work without an explicit `start` first. */
async function ensureSession(socket: string, name: string): Promise<void> {
  const existing = await BrowserControl.find(name)
  if (existing?.status === "running") return
  await rpc(socket, "start", { name })
}

export const BrowserControlTool = Tool.define<typeof parameters, Metadata>("browser_control", {
  description: DESCRIPTION,
  parameters,
  output,
  async execute(params, ctx): Promise<Tool.Result<Metadata>> {
    await ctx.ask({
      permission: "browser_control",
      patterns: [params.action, params.name ?? "*"],
      always: ["*"],
      metadata: { action: params.action, name: params.name },
    })
    ctx.metadata({
      title: params.name ? `Browser Control · ${params.action} · ${params.name}` : `Browser Control · ${params.action}`,
      metadata: baseMetadata(params.action, params.name),
    })

    if (params.action === "close_all") {
      await BrowserControl.closeAll()
      return {
        title: "Browser Control · close_all",
        output: "Closed all sessions and stopped the daemon.",
        value: { action: "close_all" as const, closed: true as const },
        metadata: baseMetadata(params.action),
      }
    }
    if (params.action === "list") {
      const list = await BrowserControl.call<SessionInfo[]>("list")
      return {
        title: "Browser Control · list",
        output: JSON.stringify(list, null, 2),
        value: { action: "list" as const, sessions: list },
        metadata: baseMetadata(params.action),
      }
    }

    const name = BrowserControl.sessionName(ctx.sessionID, params.name)
    const socket = await BrowserControl.daemon()

    if (params.action === "start") {
      const info = await rpc<SessionInfo>(socket, "start", {
        name,
        url: params.url,
        viewport: params.viewport ? parseViewport(params.viewport) : undefined,
        record: params.record,
      })
      return {
        title: `Browser Control · start · ${name}`,
        output: JSON.stringify(info, null, 2),
        value: { action: "start" as const, name, session: info },
        metadata: baseMetadata(params.action, name),
      }
    }

    // Every other action operates on an existing session; conveniently
    // auto-start one so the agent doesn't have to call `start` first.
    const skipsAutoStart: ReadonlySet<Params["action"]> = new Set([
      "info",
      "stop",
      "remove",
      "video_path",
      "recording_data",
    ])
    if (!skipsAutoStart.has(params.action)) {
      await ensureSession(socket, name)
    }

    switch (params.action) {
      case "info": {
        const info = await rpc<SessionInfo>(socket, "info", { name })
        return {
          title: `Browser Control · info · ${name}`,
          output: JSON.stringify(info, null, 2),
          value: { action: "info" as const, name, session: info },
          metadata: baseMetadata(params.action, name),
        }
      }
      case "goto": {
        await rpc(socket, "goto", { name, url: params.url })
        const info = await rpc<SessionInfo>(socket, "info", { name })
        return {
          title: `Browser Control · goto · ${name}`,
          output: JSON.stringify(info, null, 2),
          value: { action: "goto" as const, name, session: info },
          metadata: baseMetadata(params.action, name),
        }
      }
      case "click": {
        await rpc(socket, "click", { name, selector: params.selector })
        return {
          title: `Browser Control · click · ${name}`,
          output: `Clicked ${params.selector}`,
          value: { action: "click" as const, name, selector: params.selector ?? "" },
          metadata: baseMetadata(params.action, name),
        }
      }
      case "fill": {
        await rpc(socket, "fill", { name, selector: params.selector, value: params.value })
        return {
          title: `Browser Control · fill · ${name}`,
          output: `Filled ${params.selector}`,
          value: { action: "fill" as const, name, selector: params.selector ?? "" },
          metadata: baseMetadata(params.action, name),
        }
      }
      case "hover": {
        await rpc(socket, "hover", { name, selector: params.selector })
        return {
          title: `Browser Control · hover · ${name}`,
          output: `Hovered ${params.selector}`,
          value: { action: "hover" as const, name, selector: params.selector ?? "" },
          metadata: baseMetadata(params.action, name),
        }
      }
      case "scroll": {
        await rpc(socket, "scroll", { name, dx: params.dx ?? 0, dy: params.dy ?? 0 })
        return {
          title: `Browser Control · scroll · ${name}`,
          output: "Scrolled.",
          value: { action: "scroll" as const, name, dx: params.dx ?? 0, dy: params.dy ?? 0 },
          metadata: baseMetadata(params.action, name),
        }
      }
      case "send": {
        await rpc(socket, "send", { name, mode: params.mode, input: params.input })
        return {
          title: `Browser Control · send · ${name}`,
          output: "Input sent.",
          value: { action: "send" as const, name, mode: params.mode ?? "text" },
          metadata: baseMetadata(params.action, name),
        }
      }
      case "wait": {
        const result = await rpc(socket, "wait", { name, condition: waitCondition(params) })
        return {
          title: `Browser Control · wait · ${name}`,
          output: JSON.stringify(result, null, 2),
          value: { action: "wait" as const, name, result },
          metadata: baseMetadata(params.action, name),
        }
      }
      case "snapshot": {
        const frame = await rpc<JSONFrame>(socket, "snapshot", { name })
        if (params.format === "text") {
          return {
            title: `Browser Control · snapshot · ${name}`,
            output: frame.text,
            value: { action: "snapshot" as const, name, format: "text" as const, text: frame.text },
            metadata: baseMetadata(params.action, name),
          }
        }
        if (params.format === "json") {
          return {
            title: `Browser Control · snapshot · ${name}`,
            output: JSON.stringify(frame, null, 2),
            value: { action: "snapshot" as const, name, format: "json" as const, frame },
            metadata: baseMetadata(params.action, name),
          }
        }
        return {
          title: `Browser Control · snapshot · ${name}`,
          output: `Screenshot of ${frame.url} (${frame.viewport.width}x${frame.viewport.height}).`,
          // The image itself travels as an attachment, so the machine value
          // carries the frame without the base64 payload duplicated into it.
          value: { action: "snapshot" as const, name, format: "png" as const, frame },
          metadata: baseMetadata(params.action, name),
          attachments: [imageAttachment(ctx, frame.screenshotBase64)],
        }
      }
      case "resize": {
        const size = params.viewport
          ? parseViewport(params.viewport)
          : { width: params.width ?? 1280, height: params.height ?? 800 }
        const info = await rpc<SessionInfo>(socket, "resize", { name, ...size })
        return {
          title: `Browser Control · resize · ${name}`,
          output: JSON.stringify(info, null, 2),
          value: { action: "resize" as const, name, session: info },
          metadata: baseMetadata(params.action, name),
        }
      }
      case "stop": {
        await rpc(socket, "stop", { name })
        return {
          title: `Browser Control · stop · ${name}`,
          output: `Stopped ${name}.`,
          value: { action: "stop" as const, name, stopped: true as const },
          metadata: baseMetadata(params.action, name),
        }
      }
      case "remove": {
        await rpc(socket, "remove", { name })
        return {
          title: `Browser Control · remove · ${name}`,
          output: `Removed ${name}.`,
          value: { action: "remove" as const, name, removed: true as const },
          metadata: baseMetadata(params.action, name),
        }
      }
      case "restart": {
        const info = await rpc<SessionInfo>(socket, "restart", { name })
        return {
          title: `Browser Control · restart · ${name}`,
          output: JSON.stringify(info, null, 2),
          value: { action: "restart" as const, name, session: info },
          metadata: baseMetadata(params.action, name),
        }
      }
      case "start_recording": {
        await rpc(socket, "startRecording", { name, sampleFps: params.sample_fps })
        return {
          title: `Browser Control · start_recording · ${name}`,
          output: `Recording started${params.sample_fps ? ` @ ${params.sample_fps}fps` : ""}.`,
          value: startedRecording(name, params.sample_fps),
          metadata: baseMetadata(params.action, name),
        }
      }
      case "marker": {
        const marker = await rpc(socket, "marker", { name, markerName: params.marker_name })
        return {
          title: `Browser Control · marker · ${name}`,
          output: JSON.stringify(marker, null, 2),
          value: { action: "marker" as const, name, marker },
          metadata: baseMetadata(params.action, name),
        }
      }
      case "stop_recording": {
        const data = await rpc(socket, "stopRecording", { name })
        return {
          title: `Browser Control · stop_recording · ${name}`,
          output: JSON.stringify(data, null, 2),
          value: { action: "stop_recording" as const, name, recording: data },
          metadata: baseMetadata(params.action, name),
        }
      }
      case "recording_data": {
        const data = await rpc(socket, "recordingData", { name })
        return {
          title: `Browser Control · recording_data · ${name}`,
          output: JSON.stringify(data, null, 2),
          value: { action: "recording_data" as const, name, recording: data },
          metadata: baseMetadata(params.action, name),
        }
      }
      case "video_path": {
        const result = await rpc<{ path?: string }>(socket, "videoPath", { name })
        return {
          title: `Browser Control · video_path · ${name}`,
          output: result.path ?? "No video (session not started with record:true, or not yet stopped).",
          value: { action: "video_path" as const, name, path: result.path ?? null },
          metadata: baseMetadata(params.action, name),
        }
      }
      default: {
        const never: never = params.action
        throw new Error(`Unhandled browser_control action: ${never}`)
      }
    }
  },
})
