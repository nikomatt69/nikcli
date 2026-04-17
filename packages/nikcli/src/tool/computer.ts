import { Tool } from "./tool"
import DESCRIPTION from "./computer.txt"
import z from "zod"
import { Config } from "@/config/config"
import { Identifier } from "@/id/id"
import type { MessageV2 } from "@/session/message-v2"
import { spawn } from "child_process"
import { mkdtemp, readFile, rm } from "fs/promises"
import os from "os"
import path from "path"
import { Instance } from "@/project/instance"

type Coordinate = [number, number]
type Button = "left" | "right" | "middle"
type ScrollDirection = "up" | "down" | "left" | "right"
type Region = { x: number; y: number; w: number; h: number }

type DisplayGeom = {
  displayNumber: number
  declaredWidth: number
  declaredHeight: number
  nativeWidth: number
  nativeHeight: number
  offsetX: number
  offsetY: number
  scaleX: number
  scaleY: number
}

type ComputerMetadata = {
  action: string
  displayWidth: number
  displayHeight: number
  displayNumber: number
  truncated?: boolean
  outputPath?: string
}

type DisplaySpec = {
  width: number
  height: number
  x: number
  y: number
}

const ACTIONS = [
  "screenshot",
  "key",
  "hold_key",
  "type",
  "cursor_position",
  "mouse_move",
  "left_mouse_down",
  "left_mouse_up",
  "left_click",
  "left_click_drag",
  "right_click",
  "middle_click",
  "double_click",
  "triple_click",
  "scroll",
  "wait",
] as const

const coord = z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()])
const readOnlyActions = new Set(["screenshot", "cursor_position", "wait"])
const rateState = Instance.state(() => new Map<string, number[]>())

function linuxResizeTool() {
  if (Bun.which("magick")) return "magick"
  if (Bun.which("ffmpeg")) return "ffmpeg"
  return undefined
}

const parameters = z
  .object({
    action: z.enum(ACTIONS).describe("Computer-use action to dispatch."),
    coordinate: coord.optional().describe("[x,y] in logical pixels reported by the host."),
    start_coordinate: coord.optional().describe("Drag starting point."),
    text: z.string().optional().describe("Text to type, or key spec ('ctrl+a','Return')."),
    duration: z.number().min(0).max(60).optional().describe("Seconds."),
    scroll_direction: z.enum(["up", "down", "left", "right"]).optional(),
    scroll_amount: z.number().int().min(0).max(100).optional(),
    display_number: z.number().int().min(0).optional().describe("0-based display index."),
  })
  .superRefine((value, ctx) => {
    if (
      ["mouse_move", "left_click", "right_click", "middle_click", "double_click", "triple_click", "scroll"].includes(
        value.action,
      ) &&
      !value.coordinate
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["coordinate"],
        message: `coordinate is required for ${value.action}`,
      })
    }
    if (value.action === "left_click_drag") {
      if (!value.coordinate) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["coordinate"],
          message: "coordinate is required for left_click_drag",
        })
      }
      if (!value.start_coordinate) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["start_coordinate"],
          message: "start_coordinate is required for left_click_drag",
        })
      }
    }
    if (["type", "key"].includes(value.action) && !value.text) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["text"], message: `text is required for ${value.action}` })
    }
    if (value.action === "hold_key") {
      if (!value.text) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["text"], message: "text is required for hold_key" })
      }
      if (value.duration === undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["duration"], message: "duration is required for hold_key" })
      }
    }
    if (value.action === "wait" && value.duration === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["duration"], message: "duration is required for wait" })
    }
    if (value.action === "scroll") {
      if (!value.scroll_direction) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["scroll_direction"],
          message: "scroll_direction is required for scroll",
        })
      }
      if (value.scroll_amount === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["scroll_amount"],
          message: "scroll_amount is required for scroll",
        })
      }
    }
  })

function truncateApprovalText(text?: string) {
  if (!text) return text
  return text.length > 64 ? text.slice(0, 61) + "..." : text
}

function parsePngSize(buffer: Buffer) {
  if (buffer.length < 24 || buffer.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
    throw new Error("Expected PNG screenshot output from the host adapter.")
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

function pointInRegion([x, y]: Coordinate, region: Region) {
  return x >= region.x && x < region.x + region.w && y >= region.y && y < region.y + region.h
}

function assertCoordinate(label: string, point: Coordinate, geom: DisplayGeom, regions: Region[]) {
  const [x, y] = point
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error(`${label} must contain finite numeric values.`)
  }
  if (x < 0 || y < 0 || x >= geom.declaredWidth || y >= geom.declaredHeight) {
    throw new Error(
      `${label} ${JSON.stringify(point)} is outside the declared viewport ${geom.declaredWidth}x${geom.declaredHeight}.`,
    )
  }
  const hit = regions.find((item) => pointInRegion(point, item))
  if (hit) {
    throw new Error(
      `${label} ${JSON.stringify(point)} falls inside forbidden region (${hit.x},${hit.y},${hit.w},${hit.h}).`,
    )
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function toNative(point: Coordinate, geom: DisplayGeom): Coordinate {
  const x = Math.round(point[0] * geom.scaleX) + geom.offsetX
  const y = Math.round(point[1] * geom.scaleY) + geom.offsetY
  return [
    clamp(x <= geom.offsetX ? geom.offsetX + 1 : x, geom.offsetX, geom.offsetX + geom.nativeWidth - 1),
    clamp(y <= geom.offsetY ? geom.offsetY + 1 : y, geom.offsetY, geom.offsetY + geom.nativeHeight - 1),
  ]
}

function toLogical(point: Coordinate, geom: DisplayGeom): Coordinate {
  return [
    clamp(Math.round((point[0] - geom.offsetX) / geom.scaleX), 0, geom.declaredWidth - 1),
    clamp(Math.round((point[1] - geom.offsetY) / geom.scaleY), 0, geom.declaredHeight - 1),
  ]
}

async function sleepWithAbort(ms: number, signal: AbortSignal) {
  if (signal.aborted) throw new Error("Operation aborted")
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new Error("Operation aborted"))
    }
    signal.addEventListener("abort", onAbort, { once: true })
  })
}

async function run(command: string, args: string[], signal: AbortSignal, input?: string | Buffer): Promise<Buffer> {
  if (!path.isAbsolute(command) && !Bun.which(command)) {
    throw new Error(`${command} is required but was not found on PATH.`)
  }
  return await new Promise<Buffer>((resolve, reject) => {
    const proc = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let settled = false

    const finishError = (error: unknown) => {
      if (settled) return
      settled = true
      reject(error)
    }

    const abort = () => {
      if (!settled) proc.kill("SIGTERM")
    }

    if (signal.aborted) abort()
    signal.addEventListener("abort", abort, { once: true })
    proc.stdout?.on("data", (chunk) => stdout.push(Buffer.from(chunk)))
    proc.stderr?.on("data", (chunk) => stderr.push(Buffer.from(chunk)))
    proc.once("error", finishError)
    proc.once("close", (code) => {
      signal.removeEventListener("abort", abort)
      if (settled) return
      settled = true
      if (signal.aborted) {
        reject(new Error("Operation aborted"))
        return
      }
      if (code !== 0) {
        reject(new Error(Buffer.concat(stderr).toString().trim() || `${command} exited with code ${code}`))
        return
      }
      resolve(Buffer.concat(stdout))
    })
    if (input !== undefined) proc.stdin?.end(input)
    else proc.stdin?.end()
  })
}

async function runText(command: string, args: string[], signal: AbortSignal, input?: string | Buffer) {
  return (await run(command, args, signal, input)).toString().trim()
}

async function withTempDir<T>(fn: (dir: string) => Promise<T>) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "nikcli-computer-"))
  try {
    return await fn(dir)
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
}

async function getDisplays(signal: AbortSignal): Promise<DisplaySpec[]> {
  if (process.platform === "darwin") {
    const script = String.raw`
import CoreGraphics
import Foundation
var count: UInt32 = 0
CGGetActiveDisplayList(0, nil, &count)
var ids = Array(repeating: CGDirectDisplayID(), count: Int(count))
CGGetActiveDisplayList(count, &ids, &count)
let displays = ids.prefix(Int(count)).map { id in
  let bounds = CGDisplayBounds(id)
  return ["width": Int(CGDisplayPixelsWide(id)), "height": Int(CGDisplayPixelsHigh(id)), "x": Int(bounds.origin.x), "y": Int(bounds.origin.y)]
}
let data = try JSONSerialization.data(withJSONObject: displays)
FileHandle.standardOutput.write(data)
`
    return JSON.parse(await runText("swift", ["-e", script], signal)) as DisplaySpec[]
  }

  if (process.platform === "linux") {
    const sessionType =
      process.env.XDG_SESSION_TYPE ?? (process.env.WAYLAND_DISPLAY ? "wayland" : process.env.DISPLAY ? "x11" : "none")
    if (sessionType === "none") throw new Error("Computer use is unavailable in headless or SSH sessions.")
    if (sessionType === "x11") {
      const text = await runText("xrandr", ["--listactivemonitors"], signal)
      const monitors = text
        .split("\n")
        .slice(1)
        .map((line) => line.match(/\s*\d+:\s+\+\*?[^ ]+\s+(\d+)\/\d+x(\d+)\/\d+\+(\d+)\+(\d+)/))
        .filter((match): match is RegExpMatchArray => !!match)
        .map((match) => ({
          width: Number(match[1]),
          height: Number(match[2]),
          x: Number(match[3]),
          y: Number(match[4]),
        }))
      if (monitors.length) return monitors
      const [width, height] = (await runText("xdotool", ["getdisplaygeometry"], signal)).split(/\s+/).map(Number)
      return [{ width, height, x: 0, y: 0 }]
    }
    throw new Error("Wayland computer use requires compositor-specific tooling and is not enabled yet.")
  }

  if (process.platform === "win32") {
    const script = String.raw`
Add-Type -AssemblyName System.Windows.Forms
([System.Windows.Forms.Screen]::AllScreens | ForEach-Object {
  [PSCustomObject]@{ width = $_.Bounds.Width; height = $_.Bounds.Height; x = $_.Bounds.X; y = $_.Bounds.Y }
}) | ConvertTo-Json -Compress
`
    const parsed = JSON.parse(await runText("powershell", ["-NoProfile", "-Command", script], signal))
    return Array.isArray(parsed) ? parsed : [parsed]
  }

  throw new Error(`Unsupported platform: ${process.platform}`)
}

async function resolveGeom(displayNumber: number | undefined, signal: AbortSignal): Promise<DisplayGeom> {
  const config = await Config.get()
  if (config.computer?.enabled === false) throw new Error("Computer use is disabled in config.computer.enabled.")
  const displays = await getDisplays(signal)
  const selected = displayNumber ?? config.computer?.display?.number ?? 0
  const display = displays[selected]
  if (!display) throw new Error(`Display ${selected} is not available. Active displays: ${displays.length}.`)
  const configuredWidth = config.computer?.display?.width
  const configuredHeight = config.computer?.display?.height
  const resizeTool = process.platform === "linux" ? linuxResizeTool() : undefined
  const declaredWidth = configuredWidth ?? (process.platform === "linux" && !resizeTool ? display.width : 1280)
  const declaredHeight = configuredHeight ?? (process.platform === "linux" && !resizeTool ? display.height : 800)
  return {
    displayNumber: selected,
    declaredWidth,
    declaredHeight,
    nativeWidth: display.width,
    nativeHeight: display.height,
    offsetX: display.x,
    offsetY: display.y,
    scaleX: display.width / declaredWidth,
    scaleY: display.height / declaredHeight,
  }
}

async function captureScreenshot(geom: DisplayGeom, signal: AbortSignal): Promise<Buffer> {
  return await withTempDir(async (dir) => {
    const rawPath = path.join(dir, "capture.png")
    if (process.platform === "darwin") {
      await run("screencapture", ["-x", "-t", "png", "-D", String(geom.displayNumber + 1), rawPath], signal)
      const raw = await readFile(rawPath)
      const size = parsePngSize(raw)
      geom.nativeWidth = size.width
      geom.nativeHeight = size.height
      geom.scaleX = geom.nativeWidth / geom.declaredWidth
      geom.scaleY = geom.nativeHeight / geom.declaredHeight
      if (size.width === geom.declaredWidth && size.height === geom.declaredHeight) return raw
      const scaledPath = path.join(dir, "scaled.png")
      await run(
        "sips",
        ["-z", String(geom.declaredHeight), String(geom.declaredWidth), rawPath, "--out", scaledPath],
        signal,
      )
      return await readFile(scaledPath)
    }
    if (process.platform === "linux") {
      const area = `${geom.offsetX},${geom.offsetY},${geom.nativeWidth},${geom.nativeHeight}`
      await run("scrot", [rawPath, "-a", area, "-o"], signal)
      if (geom.nativeWidth === geom.declaredWidth && geom.nativeHeight === geom.declaredHeight) {
        return await readFile(rawPath)
      }
      const resizeTool = linuxResizeTool()
      const scaledPath = path.join(dir, "scaled.png")
      if (resizeTool === "magick") {
        await run("magick", [rawPath, "-resize", `${geom.declaredWidth}x${geom.declaredHeight}!`, scaledPath], signal)
        return await readFile(scaledPath)
      }
      if (resizeTool === "ffmpeg") {
        await run(
          "ffmpeg",
          ["-y", "-i", rawPath, "-vf", `scale=${geom.declaredWidth}:${geom.declaredHeight}`, scaledPath],
          signal,
        )
        return await readFile(scaledPath)
      }
      throw new Error(
        "Linux screenshots require magick or ffmpeg when the declared viewport differs from the native display size.",
      )
    }
    if (process.platform === "win32") {
      const script = String.raw`
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$screen = [System.Windows.Forms.Screen]::AllScreens[${geom.displayNumber}]
$bounds = $screen.Bounds
$bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($bounds.X, $bounds.Y, 0, 0, $bitmap.Size)
if ($bounds.Width -ne ${geom.declaredWidth} -or $bounds.Height -ne ${geom.declaredHeight}) {
  $scaled = New-Object System.Drawing.Bitmap ${geom.declaredWidth}, ${geom.declaredHeight}
  $scaledGraphics = [System.Drawing.Graphics]::FromImage($scaled)
  $scaledGraphics.DrawImage($bitmap, 0, 0, ${geom.declaredWidth}, ${geom.declaredHeight})
  $bitmap.Dispose()
  $scaledGraphics.Dispose()
  $bitmap = $scaled
}
$bitmap.Save(${JSON.stringify(rawPath)}, [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose()
$bitmap.Dispose()
`
      await run("powershell", ["-NoProfile", "-Command", script], signal)
      return await readFile(rawPath)
    }
    throw new Error(`Unsupported platform: ${process.platform}`)
  })
}

async function getCursorPosition(geom: DisplayGeom, signal: AbortSignal): Promise<Coordinate> {
  if (process.platform === "darwin") {
    const script = String.raw`
import CoreGraphics
import Foundation
let location = CGEvent(source: nil)!.location
let data = try JSONSerialization.data(withJSONObject: [Int(location.x), Int(location.y)])
FileHandle.standardOutput.write(data)
`
    const native = JSON.parse(await runText("swift", ["-e", script], signal)) as Coordinate
    return toLogical(native, geom)
  }

  if (process.platform === "linux") {
    const text = await runText("xdotool", ["getmouselocation", "--shell"], signal)
    const x = Number(text.match(/^X=(\d+)/m)?.[1] ?? 0)
    const y = Number(text.match(/^Y=(\d+)/m)?.[1] ?? 0)
    return toLogical([x, y], geom)
  }

  if (process.platform === "win32") {
    const script = String.raw`
Add-Type -AssemblyName System.Windows.Forms
$p = [System.Windows.Forms.Cursor]::Position
[Console]::Out.Write(($p.X.ToString() + "," + $p.Y.ToString()))
`
    const [x, y] = (await runText("powershell", ["-NoProfile", "-Command", script], signal)).split(",").map(Number)
    return toLogical([x, y], geom)
  }

  throw new Error(`Unsupported platform: ${process.platform}`)
}

async function assertKeyboardAllowed(geom: DisplayGeom, regions: Region[], signal: AbortSignal) {
  if (regions.length === 0) return
  const cursor = await getCursorPosition(geom, signal)
  const hit = regions.find((item) => pointInRegion(cursor, item))
  if (!hit) return
  throw new Error(
    `Keyboard input is blocked because the current cursor position [${cursor.join(", ")}] is inside forbidden region (${hit.x},${hit.y},${hit.w},${hit.h}).`,
  )
}

async function macMouse(script: string, signal: AbortSignal) {
  await run("swift", ["-e", script], signal)
}

async function macType(text: string, signal: AbortSignal) {
  const payload = JSON.stringify(text)
  const script = String.raw`
import ApplicationServices
import Foundation
func postKey(_ code: CGKeyCode, flags: CGEventFlags = []) {
  let down = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: true)!
  down.flags = flags
  down.post(tap: .cghidEventTap)
  let up = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: false)!
  up.flags = flags
  up.post(tap: .cghidEventTap)
}
let text = ${payload}
for scalar in text.unicodeScalars {
  if scalar.value == 10 {
    postKey(36)
    continue
  }
  var value = UInt16(scalar.value)
  let down = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: true)!
  down.keyboardSetUnicodeString(stringLength: 1, unicodeString: &value)
  down.post(tap: .cghidEventTap)
  let up = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: false)!
  up.keyboardSetUnicodeString(stringLength: 1, unicodeString: &value)
  up.post(tap: .cghidEventTap)
}
`
  await run("swift", ["-e", script], signal)
}

const MAC_MODIFIERS: Record<string, string> = {
  cmd: ".maskCommand",
  command: ".maskCommand",
  ctrl: ".maskControl",
  control: ".maskControl",
  shift: ".maskShift",
  alt: ".maskAlternate",
  option: ".maskAlternate",
}

const MAC_KEYS: Record<string, number> = {
  a: 0,
  s: 1,
  d: 2,
  f: 3,
  h: 4,
  g: 5,
  z: 6,
  x: 7,
  c: 8,
  v: 9,
  b: 11,
  q: 12,
  w: 13,
  e: 14,
  r: 15,
  y: 16,
  t: 17,
  "1": 18,
  "2": 19,
  "3": 20,
  "4": 21,
  "6": 22,
  "5": 23,
  equals: 24,
  "9": 25,
  "7": 26,
  minus: 27,
  "8": 28,
  "0": 29,
  right_bracket: 30,
  o: 31,
  u: 32,
  left_bracket: 33,
  i: 34,
  p: 35,
  return: 36,
  enter: 36,
  l: 37,
  j: 38,
  quote: 39,
  k: 40,
  semicolon: 41,
  backslash: 42,
  comma: 43,
  slash: 44,
  n: 45,
  m: 46,
  period: 47,
  tab: 48,
  space: 49,
  backspace: 51,
  escape: 53,
  esc: 53,
  left: 123,
  right: 124,
  down: 125,
  up: 126,
  page_down: 121,
  pagedown: 121,
  page_up: 116,
  pageup: 116,
  home: 115,
  end: 119,
}

function parseMacKeySpec(spec: string) {
  const parts = spec
    .split("+")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
  const key = parts.findLast((item) => !MAC_MODIFIERS[item])
  if (!key) throw new Error(`Unsupported macOS key spec: ${spec}`)
  const code = MAC_KEYS[key]
  if (code === undefined) throw new Error(`Unsupported macOS key token: ${key}`)
  const flags = parts
    .filter((item) => MAC_MODIFIERS[item])
    .map((item) => MAC_MODIFIERS[item])
    .join(", ")
  return { code, flags }
}

async function macKey(spec: string, signal: AbortSignal, holdSeconds?: number) {
  const parsed = parseMacKeySpec(spec)
  const flags = parsed.flags ? `[${parsed.flags}]` : "[]"
  const holdBody = holdSeconds !== undefined ? `Thread.sleep(forTimeInterval: ${holdSeconds})` : ""
  const script = String.raw`
import ApplicationServices
import Foundation
let down = CGEvent(keyboardEventSource: nil, virtualKey: ${parsed.code}, keyDown: true)!
down.flags = ${flags}
down.post(tap: .cghidEventTap)
${holdBody}
let up = CGEvent(keyboardEventSource: nil, virtualKey: ${parsed.code}, keyDown: false)!
up.flags = ${flags}
up.post(tap: .cghidEventTap)
`
  await run("swift", ["-e", script], signal)
}

async function dispatchMacMouse(
  button: Button,
  action: string,
  point: Coordinate,
  signal: AbortSignal,
  start?: Coordinate,
) {
  if (action === "move") {
    await macMouse(
      `import ApplicationServices\nlet event = CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: CGPoint(x: ${point[0]}, y: ${point[1]}), mouseButton: .left)!\nevent.post(tap: .cghidEventTap)`,
      signal,
    )
    return
  }
  const map =
    button === "left"
      ? { down: "leftMouseDown", up: "leftMouseUp", drag: "leftMouseDragged", btn: "left" }
      : button === "right"
        ? { down: "rightMouseDown", up: "rightMouseUp", drag: "rightMouseDragged", btn: "right" }
        : { down: "otherMouseDown", up: "otherMouseUp", drag: "otherMouseDragged", btn: "center" }
  if (action === "down") {
    await macMouse(
      `import ApplicationServices\nCGEvent(mouseEventSource: nil, mouseType: .${map.down}, mouseCursorPosition: CGPoint(x: ${point[0]}, y: ${point[1]}), mouseButton: .${map.btn})!.post(tap: .cghidEventTap)`,
      signal,
    )
    return
  }
  if (action === "up") {
    await macMouse(
      `import ApplicationServices\nCGEvent(mouseEventSource: nil, mouseType: .${map.up}, mouseCursorPosition: CGPoint(x: ${point[0]}, y: ${point[1]}), mouseButton: .${map.btn})!.post(tap: .cghidEventTap)`,
      signal,
    )
    return
  }
  if (action === "drag" && start) {
    await macMouse(
      `import ApplicationServices\nlet start = CGPoint(x: ${start[0]}, y: ${start[1]})\nlet end = CGPoint(x: ${point[0]}, y: ${point[1]})\nCGEvent(mouseEventSource: nil, mouseType: .${map.down}, mouseCursorPosition: start, mouseButton: .${map.btn})!.post(tap: .cghidEventTap)\nCGEvent(mouseEventSource: nil, mouseType: .${map.drag}, mouseCursorPosition: end, mouseButton: .${map.btn})!.post(tap: .cghidEventTap)\nCGEvent(mouseEventSource: nil, mouseType: .${map.up}, mouseCursorPosition: end, mouseButton: .${map.btn})!.post(tap: .cghidEventTap)`,
      signal,
    )
    return
  }
  const count = action === "double" ? 2 : action === "triple" ? 3 : 1
  await macMouse(
    `import ApplicationServices\nfor index in 1...${count} {\n  let down = CGEvent(mouseEventSource: nil, mouseType: .${map.down}, mouseCursorPosition: CGPoint(x: ${point[0]}, y: ${point[1]}), mouseButton: .${map.btn})!\n  down.setIntegerValueField(.mouseEventClickState, value: Int64(index))\n  down.post(tap: .cghidEventTap)\n  let up = CGEvent(mouseEventSource: nil, mouseType: .${map.up}, mouseCursorPosition: CGPoint(x: ${point[0]}, y: ${point[1]}), mouseButton: .${map.btn})!\n  up.setIntegerValueField(.mouseEventClickState, value: Int64(index))\n  up.post(tap: .cghidEventTap)\n}`,
    signal,
  )
}

async function dispatchLinuxX11(
  action: z.infer<typeof parameters>,
  geom: DisplayGeom,
  regions: Region[],
  signal: AbortSignal,
) {
  if (action.action === "cursor_position") {
    const text = await runText("xdotool", ["getmouselocation", "--shell"], signal)
    const x = Number(text.match(/^X=(\d+)/m)?.[1] ?? 0)
    const y = Number(text.match(/^Y=(\d+)/m)?.[1] ?? 0)
    return { output: `Cursor position: [${toLogical([x, y], geom).join(", ")}]`, attachments: undefined }
  }
  if (action.action === "type") {
    await assertKeyboardAllowed(geom, regions, signal)
    await run("xdotool", ["type", "--delay", "0", action.text!], signal)
    return { output: `Typed ${action.text!.length} characters.`, attachments: undefined }
  }
  if (action.action === "key") {
    await assertKeyboardAllowed(geom, regions, signal)
    await run("xdotool", ["key", action.text!], signal)
    return { output: `Sent key ${action.text!}.`, attachments: undefined }
  }
  throw new Error("Linux computer use currently supports screenshot, cursor_position, type, and key on X11.")
}

export const ComputerUseTool = Tool.define<typeof parameters, ComputerMetadata>("computer_use", {
  description: DESCRIPTION,
  parameters,
  async execute(action, ctx) {
    const config = await Config.get()
    const geom = await resolveGeom(action.display_number, ctx.abort)
    const forbidden = config.computer?.forbidden_regions ?? []
    const hz = config.computer?.rate_limit_hz ?? 20
    const tracked = rateState()
    const now = Date.now()
    const bucket = tracked.get(ctx.sessionID) ?? []
    const recent = bucket.filter((item) => now - item < 1000)
    if (recent.length >= hz) {
      throw new Error(`Computer-use rate limit exceeded (${hz} actions per second).`)
    }
    recent.push(now)
    tracked.set(ctx.sessionID, recent)

    if (action.coordinate) assertCoordinate("coordinate", action.coordinate, geom, forbidden)
    if (action.start_coordinate) assertCoordinate("start_coordinate", action.start_coordinate, geom, forbidden)

    await ctx.ask({
      permission: "computer_use",
      patterns: [action.action],
      always: Array.from(readOnlyActions),
      metadata: {
        action: action.action,
        coordinate: action.coordinate,
        start_coordinate: action.start_coordinate,
        text: truncateApprovalText(action.text),
        duration: action.duration,
        scroll_direction: action.scroll_direction,
        scroll_amount: action.scroll_amount,
        display: geom.displayNumber,
      },
    })

    if (action.action === "wait") {
      await sleepWithAbort((action.duration ?? 0) * 1000, ctx.abort)
      return {
        title: "Computer wait",
        output: `Waited ${action.duration} second(s).`,
        metadata: {
          action: action.action,
          displayWidth: geom.declaredWidth,
          displayHeight: geom.declaredHeight,
          displayNumber: geom.displayNumber,
        },
      }
    }

    if (action.action === "screenshot") {
      const png = await captureScreenshot(geom, ctx.abort)
      const attachments: MessageV2.FilePart[] = [
        {
          id: Identifier.ascending("part"),
          sessionID: ctx.sessionID,
          messageID: ctx.messageID,
          type: "file",
          mime: "image/png",
          url: `data:image/png;base64,${png.toString("base64")}`,
          filename: `screenshot-${Date.now()}.png`,
        },
      ]
      return {
        title: "Computer screenshot",
        output: `${geom.declaredWidth}x${geom.declaredHeight} captured.`,
        attachments,
        metadata: {
          action: action.action,
          displayWidth: geom.declaredWidth,
          displayHeight: geom.declaredHeight,
          displayNumber: geom.displayNumber,
        },
      }
    }

    if (action.action === "cursor_position") {
      const logical = await getCursorPosition(geom, ctx.abort)
      return {
        title: "Computer cursor",
        output: `Cursor position: [${logical.join(", ")}].`,
        metadata: {
          action: action.action,
          displayWidth: geom.declaredWidth,
          displayHeight: geom.declaredHeight,
          displayNumber: geom.displayNumber,
        },
      }
    }

    if (process.platform === "linux") {
      const result = await dispatchLinuxX11(action, geom, forbidden, ctx.abort)
      return {
        title: "Computer action",
        output: result.output,
        attachments: result.attachments,
        metadata: {
          action: action.action,
          displayWidth: geom.declaredWidth,
          displayHeight: geom.declaredHeight,
          displayNumber: geom.displayNumber,
        },
      }
    }

    if (process.platform === "win32") {
      throw new Error("Windows computer input dispatch is not available yet in this build.")
    }

    if (process.platform !== "darwin") {
      throw new Error(`Unsupported platform: ${process.platform}`)
    }

    const point = action.coordinate ? toNative(action.coordinate, geom) : undefined
    const start = action.start_coordinate ? toNative(action.start_coordinate, geom) : undefined

    switch (action.action) {
      case "mouse_move":
        await dispatchMacMouse("left", "move", point!, ctx.abort)
        return {
          title: "Computer action",
          output: `Moved cursor to [${action.coordinate!.join(", ")}].`,
          metadata: {
            action: action.action,
            displayWidth: geom.declaredWidth,
            displayHeight: geom.declaredHeight,
            displayNumber: geom.displayNumber,
          },
        }
      case "left_click":
        await dispatchMacMouse("left", "click", point!, ctx.abort)
        return {
          title: "Computer action",
          output: `Left clicked [${action.coordinate!.join(", ")}].`,
          metadata: {
            action: action.action,
            displayWidth: geom.declaredWidth,
            displayHeight: geom.declaredHeight,
            displayNumber: geom.displayNumber,
          },
        }
      case "right_click":
        await dispatchMacMouse("right", "click", point!, ctx.abort)
        return {
          title: "Computer action",
          output: `Right clicked [${action.coordinate!.join(", ")}].`,
          metadata: {
            action: action.action,
            displayWidth: geom.declaredWidth,
            displayHeight: geom.declaredHeight,
            displayNumber: geom.displayNumber,
          },
        }
      case "middle_click":
        await dispatchMacMouse("middle", "click", point!, ctx.abort)
        return {
          title: "Computer action",
          output: `Middle clicked [${action.coordinate!.join(", ")}].`,
          metadata: {
            action: action.action,
            displayWidth: geom.declaredWidth,
            displayHeight: geom.declaredHeight,
            displayNumber: geom.displayNumber,
          },
        }
      case "double_click":
        await dispatchMacMouse("left", "double", point!, ctx.abort)
        return {
          title: "Computer action",
          output: `Double clicked [${action.coordinate!.join(", ")}].`,
          metadata: {
            action: action.action,
            displayWidth: geom.declaredWidth,
            displayHeight: geom.declaredHeight,
            displayNumber: geom.displayNumber,
          },
        }
      case "triple_click":
        await dispatchMacMouse("left", "triple", point!, ctx.abort)
        return {
          title: "Computer action",
          output: `Triple clicked [${action.coordinate!.join(", ")}].`,
          metadata: {
            action: action.action,
            displayWidth: geom.declaredWidth,
            displayHeight: geom.declaredHeight,
            displayNumber: geom.displayNumber,
          },
        }
      case "left_mouse_down":
        await dispatchMacMouse("left", "down", point!, ctx.abort)
        return {
          title: "Computer action",
          output: `Pressed left mouse button at [${action.coordinate!.join(", ")}].`,
          metadata: {
            action: action.action,
            displayWidth: geom.declaredWidth,
            displayHeight: geom.declaredHeight,
            displayNumber: geom.displayNumber,
          },
        }
      case "left_mouse_up":
        await dispatchMacMouse("left", "up", point!, ctx.abort)
        return {
          title: "Computer action",
          output: `Released left mouse button at [${action.coordinate!.join(", ")}].`,
          metadata: {
            action: action.action,
            displayWidth: geom.declaredWidth,
            displayHeight: geom.declaredHeight,
            displayNumber: geom.displayNumber,
          },
        }
      case "left_click_drag":
        await dispatchMacMouse("left", "drag", point!, ctx.abort, start!)
        return {
          title: "Computer action",
          output: `Dragged from [${action.start_coordinate!.join(", ")}] to [${action.coordinate!.join(", ")}].`,
          metadata: {
            action: action.action,
            displayWidth: geom.declaredWidth,
            displayHeight: geom.declaredHeight,
            displayNumber: geom.displayNumber,
          },
        }
      case "type":
        await assertKeyboardAllowed(geom, forbidden, ctx.abort)
        await macType(action.text!, ctx.abort)
        return {
          title: "Computer action",
          output: `Typed ${action.text!.length} characters.`,
          metadata: {
            action: action.action,
            displayWidth: geom.declaredWidth,
            displayHeight: geom.declaredHeight,
            displayNumber: geom.displayNumber,
          },
        }
      case "key":
        await assertKeyboardAllowed(geom, forbidden, ctx.abort)
        await macKey(action.text!, ctx.abort)
        return {
          title: "Computer action",
          output: `Sent key ${action.text!}.`,
          metadata: {
            action: action.action,
            displayWidth: geom.declaredWidth,
            displayHeight: geom.declaredHeight,
            displayNumber: geom.displayNumber,
          },
        }
      case "hold_key":
        await assertKeyboardAllowed(geom, forbidden, ctx.abort)
        await macKey(action.text!, ctx.abort, action.duration)
        return {
          title: "Computer action",
          output: `Held key ${action.text!} for ${action.duration} second(s).`,
          metadata: {
            action: action.action,
            displayWidth: geom.declaredWidth,
            displayHeight: geom.declaredHeight,
            displayNumber: geom.displayNumber,
          },
        }
      case "scroll": {
        const amount = action.scroll_amount ?? 0
        const direction = action.scroll_direction!
        await dispatchMacMouse("left", "move", point!, ctx.abort)
        const deltaY = direction === "up" ? amount : direction === "down" ? -amount : 0
        const deltaX = direction === "left" ? amount : direction === "right" ? -amount : 0
        await macMouse(
          `import ApplicationServices\nCGEvent(scrollWheelEvent2Source: nil, units: .line, wheelCount: 2, wheel1: Int32(${deltaY}), wheel2: Int32(${deltaX}), wheel3: 0)!.post(tap: .cghidEventTap)`,
          ctx.abort,
        )
        return {
          title: "Computer action",
          output: `Scrolled ${direction} by ${amount} at [${action.coordinate!.join(", ")}].`,
          metadata: {
            action: action.action,
            displayWidth: geom.declaredWidth,
            displayHeight: geom.declaredHeight,
            displayNumber: geom.displayNumber,
          },
        }
      }
      default:
        throw new Error(`Unsupported computer action: ${action.action}`)
    }
  },
})
