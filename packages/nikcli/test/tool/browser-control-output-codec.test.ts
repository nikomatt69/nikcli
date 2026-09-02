import { preserveTestEnv } from "../helpers/env"
import { removeTestDir } from "../helpers/fs"
import { afterAll, describe, expect, it, mock } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-browser-codec-home-"))
process.env.NIKCLI_TEST_HOME = testHome
process.env.NIKCLI_DISABLE_PROJECT_CONFIG = "1"

preserveTestEnv(["NIKCLI_TEST_HOME", "NIKCLI_DISABLE_PROJECT_CONFIG"])

const session = {
  name: "test-session",
  url: "https://example.com",
  viewport: { width: 1280, height: 800 },
  status: "running",
  createdAt: 1_700_000_000_000,
  recording: false,
  // A field the tool does not know about. The daemon and the tool ship
  // separately, so the codec has to tolerate this rather than fail the call.
  unexpectedNewField: "from a newer daemon",
}

const frame = {
  url: "https://example.com",
  title: "Example",
  viewport: { width: 1280, height: 800 },
  screenshotBase64: "aGVsbG8=",
  text: "Example page text",
  console: [],
}

const recording = {
  version: 1,
  startedAt: 1_700_000_000_000,
  duration: 1234,
  url: "https://example.com",
  viewport: { width: 1280, height: 800 },
  samples: [],
  markers: [],
}

// Answers shaped like `daemon.ts` returns them, so the codec is exercised
// against the real payloads rather than against itself.
const answers: Record<string, unknown> = {
  start: session,
  info: session,
  goto: session,
  click: session,
  fill: session,
  hover: session,
  scroll: session,
  resize: session,
  restart: session,
  snapshot: frame,
  wait: { satisfied: true, reason: "matched", frame },
  stop: { stopped: true },
  remove: { removed: true },
  startRecording: { recording: true },
  marker: { time: 12, name: "m1", screenshot: "aGVsbG8=" },
  stopRecording: recording,
  recordingData: recording,
  videoPath: { path: "/tmp/video.webm" },
}

const calls: string[] = []

mock.module("@nikcli-ai/browser-control", () => ({
  rpc: async (_socket: string, method: string) => {
    calls.push(method)
    return answers[method]
  },
}))

mock.module("@/browser-control/browser-control", () => ({
  BrowserControl: {
    closeAll: async () => undefined,
    call: async () => [session],
    sessionName: (_sessionID: string, name?: string) => name ?? "test-session",
    daemon: async () => "/tmp/socket",
    find: async () => ({ ...session }),
  },
}))

const { BrowserControlTool } = await import("@/tool/browser-control")
const { Tool } = await import("@/tool/tool")
const { makeToolContext } = await import("../helpers/tool-context")

afterAll(async () => {
  await removeTestDir(testHome)
})

async function run(params: Record<string, unknown>) {
  const { ctx } = makeToolContext({ sessionID: "browser-codec" })
  const def = await BrowserControlTool.init()
  const result = await def.executeAsync(params as never, ctx)
  return { result, codec: def.output }
}

/**
 * T3 on the hard tool: twenty-one actions with heterogeneous results behind one
 * `output` codec. The wrapper parses `result.value` after every call, so each
 * case below is really two assertions — the shape is what the test says, and it
 * satisfies the declared union, because a call whose value did not parse would
 * have thrown before returning.
 */
describe("browser_control — output codec", () => {
  it("declares a codec", async () => {
    const def = await BrowserControlTool.init()
    expect(def.output).toBeDefined()
  })

  it("carries the session back on the actions that report one", async () => {
    for (const action of ["start", "info", "goto", "resize", "restart"]) {
      const { result } = await run({ action, url: "https://example.com", format: "png" })
      expect(result.value).toMatchObject({ action, session: { url: "https://example.com" } })
      // The model-facing string is untouched by the codec.
      expect(result.output).toBe(JSON.stringify(session, null, 2))
    }
  })

  it("keeps an unknown daemon field instead of failing the call", async () => {
    const { result } = await run({ action: "info", format: "png" })
    const value = result.value as { session: Record<string, unknown> }
    // The whole reason the payload schemas are loose: a daemon that grows a
    // field must not break a tool call that would otherwise have succeeded.
    expect(value.session.unexpectedNewField).toBe("from a newer daemon")
  })

  it("reports what it acted on for the actions that answer in prose", async () => {
    const cases: Array<[Record<string, unknown>, Record<string, unknown>]> = [
      [
        { action: "click", selector: "#go" },
        { action: "click", selector: "#go" },
      ],
      [
        { action: "fill", selector: "#q", value: "hi" },
        { action: "fill", selector: "#q" },
      ],
      [
        { action: "hover", selector: "#m" },
        { action: "hover", selector: "#m" },
      ],
      [
        { action: "scroll", dy: 400 },
        { action: "scroll", dx: 0, dy: 400 },
      ],
      [
        { action: "send", mode: "text", input: "hello" },
        { action: "send", mode: "text" },
      ],
      [{ action: "stop" }, { action: "stop", stopped: true }],
      [{ action: "remove" }, { action: "remove", removed: true }],
      [
        { action: "start_recording", sample_fps: 4 },
        { action: "start_recording", recording: true, sampleFps: 4 },
      ],
    ]

    for (const [params, expected] of cases) {
      const { result } = await run({ ...params, format: "png" })
      // These branches used to hand a machine consumer "Clicked #go" and
      // nothing else. The prose is unchanged; the value is new.
      expect(result.value).toMatchObject(expected)
      expect(typeof result.output).toBe("string")
    }
  })

  it("distinguishes the three snapshot formats", async () => {
    const png = await run({ action: "snapshot", format: "png" })
    expect(png.result.value).toMatchObject({ action: "snapshot", format: "png" })
    expect(png.result.attachments?.length).toBe(1)

    const text = await run({ action: "snapshot", format: "text" })
    expect(text.result.value).toMatchObject({ action: "snapshot", format: "text", text: frame.text })

    const json = await run({ action: "snapshot", format: "json" })
    expect(json.result.value).toMatchObject({ action: "snapshot", format: "json" })
  })

  it("covers the recording and listing actions", async () => {
    const list = await run({ action: "list", format: "png" })
    expect(list.result.value).toMatchObject({ action: "list" })
    expect((list.result.value as { sessions: unknown[] }).sessions).toHaveLength(1)

    const closeAll = await run({ action: "close_all", format: "png" })
    expect(closeAll.result.value).toEqual({ action: "close_all", closed: true })

    const marker = await run({ action: "marker", marker_name: "m1", format: "png" })
    expect(marker.result.value).toMatchObject({ action: "marker", marker: { name: "m1" } })

    const stopped = await run({ action: "stop_recording", format: "png" })
    expect(stopped.result.value).toMatchObject({ action: "stop_recording", recording: { duration: 1234 } })

    const data = await run({ action: "recording_data", format: "png" })
    expect(data.result.value).toMatchObject({ action: "recording_data", recording: { duration: 1234 } })

    const video = await run({ action: "video_path", format: "png" })
    expect(video.result.value).toEqual({ action: "video_path", name: "test-session", path: "/tmp/video.webm" })

    const wait = await run({ action: "wait", wait_for: "idle", format: "png" })
    expect(wait.result.value).toMatchObject({ action: "wait" })
  })

  it("hands Code Mode the structured value rather than the string", async () => {
    const { result, codec } = await run({ action: "info", format: "png" })
    const encoded = Tool.encoded(result, codec)
    expect(encoded).toMatchObject({ action: "info" })
    expect(typeof encoded).not.toBe("string")
  })
})
