import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./terminal_control.txt"
import { Terminal } from "@/terminal"
import { Identifier } from "@/id/id"
import type { MessageV2 } from "@/session/message-v2"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"
import { Effect } from "effect"
import { runPromiseWithLayer, withCurrentInstance } from "@/effect"
import {
  renderText,
  toAsciicast,
  renderAnimatedSvg,
  renderPngSequence,
  exportVideo,
  ffmpegAvailable,
  type RecordingData,
} from "@nikcli-ai/terminal-control"
import { mkdir, writeFile } from "fs/promises"
import path from "path"

const log = Log.create({ service: "terminal-control-tool" })

function runTerminal<A, E>(effect: Effect.Effect<A, E, Terminal.Service>): Promise<A> {
  return runPromiseWithLayer(Terminal.defaultLayer, withCurrentInstance(effect))
}

const parameters = z.object({
  action: z
    .enum([
      "start",
      "send",
      "capture",
      "wait",
      "resize",
      "list",
      "stop",
      "restart",
      "logs",
      "record",
      "marker",
      "stop_recording",
      "export",
    ])
    .describe(
      "What to do: 'start' a TUI session, 'send' input/keys, 'capture' the rendered screen, 'wait' for a condition, 'resize', 'list' sessions, 'stop', 'restart', read raw 'logs'; or record a timeline: 'record' (start), 'marker' (label a moment), 'stop_recording', and 'export' the recording.",
    ),
  name: z
    .string()
    .optional()
    .describe("Session name. Required for every action except 'start' (auto-generated if omitted) and 'list'."),
  command: z.string().optional().describe("[start] Program to run, e.g. 'htop', 'vim', 'top'."),
  args: z.array(z.string()).optional().describe("[start] Arguments for the command."),
  cwd: z.string().optional().describe("[start] Working directory. Defaults to the project directory."),
  cols: z.number().int().optional().describe("[start|resize] Terminal width in columns. Default 80."),
  rows: z.number().int().optional().describe("[start|resize] Terminal height in rows. Default 24."),
  input: z
    .string()
    .optional()
    .describe(
      "[send] Text to type, or whitespace-separated key names when mode='keys' (e.g. 'ctrl+c', 'enter', 'down down enter').",
    ),
  mode: z
    .enum(["text", "keys"])
    .optional()
    .describe("[send] 'text' writes verbatim; 'keys' translates key names. Default 'text'."),
  format: z
    .enum(["text", "ansi", "json", "svg", "png"])
    .optional()
    .describe(
      "[capture] Output format. 'text' (default) is the rendered screen; 'svg'/'png' are returned as image attachments.",
    ),
  until: z.enum(["text", "stable", "timeout"]).optional().describe("[wait] Condition type. Default 'stable'."),
  value: z.string().optional().describe("[wait] Text to wait for when until='text'."),
  timeout: z.number().int().optional().describe("[wait] Timeout in ms (text/stable). Default 10000."),
  lines: z.number().int().optional().describe("[logs] Number of trailing lines of raw output to return."),
  marker_name: z.string().optional().describe("[marker] Name/label for the marker to place in the active recording."),
  export_format: z
    .enum(["asciicast", "json", "svganim", "frames", "gif", "mp4"])
    .optional()
    .describe(
      "[export] Output format. 'asciicast' (asciinema v2, default) and 'json' return text; 'svganim' is a self-contained animated SVG attachment; 'frames' writes a PNG sequence; 'gif'/'mp4' need ffmpeg.",
    ),
  fps: z
    .number()
    .int()
    .optional()
    .describe("[export] Frames per second to sample for svganim/frames/gif/mp4. Default 8."),
  speed: z
    .number()
    .optional()
    .describe("[export] Playback speed multiplier for svganim/gif/mp4 (>1 = faster). Default 1."),
})

type Params = z.infer<typeof parameters>

function requireName(params: Params): string {
  if (!params.name) throw new Error(`The 'name' parameter is required for action '${params.action}'.`)
  return params.name
}

function imageAttachment(
  ctx: Tool.Context,
  mime: string,
  bytes: Uint8Array | string,
  filename: string,
): MessageV2.FilePart {
  const base64 =
    typeof bytes === "string" ? Buffer.from(bytes).toString("base64") : Buffer.from(bytes).toString("base64")
  return {
    id: Identifier.ascending("part"),
    sessionID: ctx.sessionID,
    messageID: ctx.messageID,
    type: "file",
    mime,
    url: `data:${mime};base64,${base64}`,
    filename,
  }
}

async function exportDir(): Promise<string> {
  const dir = path.join(Instance.directory, ".nikcli", "terminal-control")
  await mkdir(dir, { recursive: true })
  return dir
}

async function exportRecording(
  ctx: Tool.Context,
  name: string,
  rec: RecordingData,
  format: "asciicast" | "json" | "svganim" | "frames" | "gif" | "mp4",
  fps: number,
  speed: number,
): Promise<Tool.Result> {
  const durationSec = (rec.duration / 1000).toFixed(2)
  switch (format) {
    case "asciicast": {
      return {
        title: `Exported "${name}" (asciicast)`,
        metadata: { action: "export", name, format, duration_ms: rec.duration },
        output: toAsciicast(rec),
      }
    }
    case "json": {
      return {
        title: `Exported "${name}" (json)`,
        metadata: { action: "export", name, format },
        output: JSON.stringify(rec),
      }
    }
    case "svganim": {
      const svg = renderAnimatedSvg(rec, { fps, speed })
      return {
        title: `Exported "${name}" (animated svg)`,
        metadata: { action: "export", name, format, events: rec.events.length },
        output: `Rendered an animated SVG of "${name}" (${durationSec}s, ${rec.events.length} events) — attached.`,
        attachments: [imageAttachment(ctx, "image/svg+xml", svg, `${name}-recording.svg`)],
      }
    }
    case "frames": {
      const dir = await exportDir()
      const frames = await renderPngSequence(rec, { fps })
      const stamp = Date.now()
      const written: string[] = []
      for (let i = 0; i < frames.length; i++) {
        const file = path.join(dir, `${name}-${stamp}-${String(i).padStart(4, "0")}.png`)
        await writeFile(file, frames[i]!.png)
        written.push(file)
      }
      const lastFrame = frames[frames.length - 1]
      return {
        title: `Exported "${name}" (${frames.length} frames)`,
        metadata: { action: "export", name, format, frames: frames.length, dir },
        output: `Wrote ${frames.length} PNG frame(s) for "${name}" to ${dir}.`,
        ...(lastFrame ? { attachments: [imageAttachment(ctx, "image/png", lastFrame.png, `${name}-final.png`)] } : {}),
      }
    }
    case "gif":
    case "mp4": {
      if (!ffmpegAvailable()) {
        throw new Error(
          "Exporting gif/mp4 requires the 'ffmpeg' binary on PATH. Use format 'svganim' for a dependency-free animated alternative.",
        )
      }
      const dir = await exportDir()
      const outPath = path.join(dir, `${name}-${Date.now()}.${format}`)
      const result = await exportVideo(rec, { format, outPath, fps, speed })
      return {
        title: `Exported "${name}" (${format})`,
        metadata: { action: "export", name, format, path: result.path, frames: result.frames },
        output: `Rendered ${result.frames} frame(s) into ${result.format.toUpperCase()} at ${result.path}.`,
      }
    }
  }
}

export const TerminalControlTool = Tool.define("terminal_control", async () => {
  return {
    description: DESCRIPTION,
    parameters,
    async execute(params: Params, ctx: Tool.Context): Promise<Tool.Result> {
      switch (params.action) {
        case "start": {
          if (!params.command) throw new Error("The 'command' parameter is required for action 'start'.")
          const cwd = params.cwd || Instance.directory
          await ctx.ask({
            permission: "bash",
            patterns: [[params.command, ...(params.args ?? [])].join(" ")],
            always: [`${params.command}*`],
            metadata: {},
          })
          log.info("start", { command: params.command, name: params.name })
          const info = await runTerminal(
            Effect.gen(function* () {
              const terminal = yield* Terminal.Service
              return yield* terminal.start({
                name: params.name,
                command: params.command!,
                args: params.args,
                cwd,
                cols: params.cols,
                rows: params.rows,
              })
            }),
          )
          ctx.metadata({ title: `start ${info.name}`, metadata: { action: "start", session: info } })
          return {
            title: `Started terminal "${info.name}"`,
            metadata: { action: "start", session: info },
            output: [
              `Started session "${info.name}" (pid ${info.pid}): ${info.command} ${info.args.join(" ")}`.trim(),
              `Size: ${info.cols}x${info.rows}. Use action 'capture' to read the screen, 'send' to drive it, 'wait' to synchronize.`,
            ].join("\n"),
          }
        }

        case "send": {
          const name = requireName(params)
          if (params.input === undefined) throw new Error("The 'input' parameter is required for action 'send'.")
          const mode = params.mode ?? "text"
          await runTerminal(
            Effect.gen(function* () {
              const terminal = yield* Terminal.Service
              return yield* terminal.send(name, params.input!, mode)
            }),
          )
          return {
            title: `Sent to "${name}"`,
            metadata: { action: "send", name, mode },
            output: `Sent ${mode === "keys" ? "keys" : "text"} to "${name}".`,
          }
        }

        case "capture": {
          const name = requireName(params)
          const format = params.format ?? "text"
          if (format === "png" || format === "svg") {
            const ext = format
            const mime = format === "png" ? "image/png" : "image/svg+xml"
            const { attachment, textPreview } = await runTerminal(
              Effect.gen(function* () {
                const terminal = yield* Terminal.Service
                const frame = yield* terminal.snapshot(name)
                const preview = renderText(frame)
                if (format === "svg") {
                  const svg = yield* terminal.render(name, "svg")
                  return { svg, png: undefined as Uint8Array | undefined, textPreview: preview }
                }
                const png = yield* terminal.renderPng(name)
                return { svg: undefined as string | undefined, png, textPreview: preview }
              }),
            ).then((r) => ({
              attachment: imageAttachment(ctx, mime, format === "svg" ? r.svg! : r.png!, `${name}-screen.${ext}`),
              textPreview: r.textPreview,
            }))
            ctx.metadata({ title: `capture ${name} (${format})`, metadata: { action: "capture", name, format } })
            return {
              title: `Captured "${name}" (${format})`,
              metadata: { action: "capture", name, format },
              output: `Captured the screen of "${name}" as ${format} (attached).\n\nText preview:\n${textPreview}`,
              attachments: [attachment],
            }
          }
          const rendered = await runTerminal(
            Effect.gen(function* () {
              const terminal = yield* Terminal.Service
              return yield* terminal.render(name, format)
            }),
          )
          ctx.metadata({ title: `capture ${name} (${format})`, metadata: { action: "capture", name, format } })
          return {
            title: `Captured "${name}" (${format})`,
            metadata: { action: "capture", name, format },
            output: rendered,
          }
        }

        case "wait": {
          const name = requireName(params)
          const until = params.until ?? "stable"
          const condition: Terminal.WaitCondition =
            until === "text"
              ? { type: "text", value: params.value ?? "", timeout: params.timeout }
              : until === "timeout"
                ? { type: "timeout", ms: params.timeout ?? 1000 }
                : { type: "stable", timeout: params.timeout }
          if (until === "text" && !params.value) {
            throw new Error("The 'value' parameter is required when waiting for action 'wait' with until='text'.")
          }
          const result = await runTerminal(
            Effect.gen(function* () {
              const terminal = yield* Terminal.Service
              return yield* terminal.wait(name, condition)
            }),
          )
          const preview = renderText(result.frame)
          return {
            title: `Waited on "${name}" (${result.reason})`,
            metadata: { action: "wait", name, satisfied: result.satisfied, reason: result.reason },
            output: [
              `Wait on "${name}" finished: ${result.reason}${result.satisfied ? "" : " (not satisfied)"}.`,
              "",
              "Screen:",
              preview,
            ].join("\n"),
          }
        }

        case "resize": {
          const name = requireName(params)
          const cols = params.cols ?? 80
          const rows = params.rows ?? 24
          const info = await runTerminal(
            Effect.gen(function* () {
              const terminal = yield* Terminal.Service
              return yield* terminal.resize(name, cols, rows)
            }),
          )
          return {
            title: `Resized "${name}"`,
            metadata: { action: "resize", session: info },
            output: `Resized "${name}" to ${info.cols}x${info.rows}.`,
          }
        }

        case "list": {
          const sessions = await runTerminal(
            Effect.gen(function* () {
              const terminal = yield* Terminal.Service
              return yield* terminal.list()
            }),
          )
          const output =
            sessions.length === 0
              ? "No active terminal sessions."
              : sessions
                  .map((s) =>
                    `- ${s.name} [${s.status}] pid=${s.pid} ${s.cols}x${s.rows}: ${s.command} ${s.args.join(" ")}`.trim(),
                  )
                  .join("\n")
          return {
            title: `Terminal sessions (${sessions.length})`,
            metadata: { action: "list", sessions },
            output,
          }
        }

        case "stop": {
          const name = requireName(params)
          await runTerminal(
            Effect.gen(function* () {
              const terminal = yield* Terminal.Service
              return yield* terminal.stop(name)
            }),
          )
          return {
            title: `Stopped "${name}"`,
            metadata: { action: "stop", name },
            output: `Stopped and removed session "${name}".`,
          }
        }

        case "restart": {
          const name = requireName(params)
          const info = await runTerminal(
            Effect.gen(function* () {
              const terminal = yield* Terminal.Service
              return yield* terminal.restart(name)
            }),
          )
          return {
            title: `Restarted "${name}"`,
            metadata: { action: "restart", session: info },
            output: `Restarted session "${name}" (pid ${info.pid}).`,
          }
        }

        case "logs": {
          const name = requireName(params)
          const raw = await runTerminal(
            Effect.gen(function* () {
              const terminal = yield* Terminal.Service
              return yield* terminal.rawOutput(name, params.lines)
            }),
          )
          return {
            title: `Logs for "${name}"`,
            metadata: { action: "logs", name },
            output: raw || "(no output captured yet)",
          }
        }

        case "record": {
          const name = requireName(params)
          await runTerminal(
            Effect.gen(function* () {
              const terminal = yield* Terminal.Service
              return yield* terminal.startRecording(name)
            }),
          )
          return {
            title: `Recording "${name}"`,
            metadata: { action: "record", name },
            output: `Started recording the timeline of "${name}". Use 'marker' to label moments, then 'stop_recording' and 'export'.`,
          }
        }

        case "marker": {
          const name = requireName(params)
          const markerName = params.marker_name
          if (!markerName) throw new Error("The 'marker_name' parameter is required for action 'marker'.")
          const placed = await runTerminal(
            Effect.gen(function* () {
              const terminal = yield* Terminal.Service
              return yield* terminal.marker(name, markerName)
            }),
          )
          return {
            title: `Marker "${markerName}"`,
            metadata: { action: "marker", name, marker: placed ?? null },
            output: placed
              ? `Placed marker "${markerName}" at ${(placed.time / 1000).toFixed(2)}s in "${name}".`
              : `Session "${name}" is not recording; start one with action 'record' first.`,
          }
        }

        case "stop_recording": {
          const name = requireName(params)
          const rec = await runTerminal(
            Effect.gen(function* () {
              const terminal = yield* Terminal.Service
              return yield* terminal.stopRecording(name)
            }),
          )
          if (!rec) {
            return {
              title: `No recording for "${name}"`,
              metadata: { action: "stop_recording", name },
              output: `Session "${name}" was not recording.`,
            }
          }
          return {
            title: `Stopped recording "${name}"`,
            metadata: {
              action: "stop_recording",
              name,
              duration_ms: rec.duration,
              events: rec.events.length,
              markers: rec.markers.length,
            },
            output: [
              `Stopped recording "${name}": ${(rec.duration / 1000).toFixed(2)}s, ${rec.events.length} output events, ${rec.markers.length} marker(s).`,
              `Use action 'export' to render it (formats: asciicast, json, svganim, frames, gif, mp4).`,
            ].join("\n"),
          }
        }

        case "export": {
          const name = requireName(params)
          const format = params.export_format ?? "asciicast"
          const fps = params.fps ?? 8
          const speed = params.speed ?? 1
          const rec = await runTerminal(
            Effect.gen(function* () {
              const terminal = yield* Terminal.Service
              return yield* terminal.recordingData(name)
            }),
          )
          if (!rec) {
            throw new Error(
              `Session "${name}" has no recording. Use action 'record' to start one (it can still be in progress when exporting).`,
            )
          }
          return await exportRecording(ctx, name, rec, format, fps, speed)
        }

        default: {
          const _exhaustive: never = params.action
          throw new Error(`Unknown terminal_control action: ${String(_exhaustive)}`)
        }
      }
    },
  }
})
