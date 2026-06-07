/**
 * Terminal — an Effect service wrapping {@link SessionManager} from
 * `@nikcli-ai/terminal-control`, giving nikcli one manager per instance whose
 * sessions persist across tool calls and are torn down when the instance is
 * released. Mirrors the structure of {@link Pty} in `src/pty/index.ts`.
 */
import {
  SessionManager,
  renderString,
  renderPng,
  type SessionInfo,
  type SendMode as SendModeType,
  type WaitCondition as WaitConditionType,
  type WaitResult as WaitResultType,
  type Frame as FrameType,
  type TextFormat as TextFormatType,
  type RecordingData,
  type RecordingMarker,
} from "@nikcli-ai/terminal-control"
import { InstanceState } from "@/effect"
import { Log } from "../util/log"
import { Context, Effect, Layer } from "effect"

export namespace Terminal {
  const log = Log.create({ service: "terminal" })

  export type Info = SessionInfo
  export type WaitCondition = WaitConditionType
  export type WaitResult = WaitResultType
  export type Frame = FrameType
  export type SendMode = SendModeType
  export type TextFormat = TextFormatType
  export type Recording = RecordingData
  export type Marker = RecordingMarker

  export interface StartInput {
    readonly name?: string
    readonly command: string
    readonly args?: ReadonlyArray<string>
    readonly cwd?: string
    readonly cols?: number
    readonly rows?: number
    readonly env?: Record<string, string>
  }

  export interface Interface {
    readonly start: (input: StartInput) => Effect.Effect<SessionInfo, Error>
    readonly list: () => Effect.Effect<SessionInfo[], never>
    readonly info: (name: string) => Effect.Effect<SessionInfo, Error>
    readonly send: (name: string, input: string, mode: SendMode) => Effect.Effect<void, Error>
    readonly wait: (name: string, condition: WaitCondition) => Effect.Effect<WaitResult, Error>
    readonly resize: (name: string, cols: number, rows: number) => Effect.Effect<SessionInfo, Error>
    readonly snapshot: (name: string) => Effect.Effect<Frame, Error>
    /** Render the current screen to a text-like format (text/ansi/json/svg). */
    readonly render: (name: string, format: TextFormat) => Effect.Effect<string, Error>
    /** Render the current screen to PNG bytes. */
    readonly renderPng: (name: string) => Effect.Effect<Uint8Array, Error>
    readonly rawOutput: (name: string, lines?: number) => Effect.Effect<string, Error>
    readonly stop: (name: string) => Effect.Effect<void, never>
    readonly restart: (name: string) => Effect.Effect<SessionInfo, Error>
    // Recording (v2)
    readonly startRecording: (name: string) => Effect.Effect<void, Error>
    readonly marker: (name: string, markerName: string) => Effect.Effect<RecordingMarker | undefined, Error>
    readonly stopRecording: (name: string) => Effect.Effect<RecordingData | null, Error>
    readonly recordingData: (name: string) => Effect.Effect<RecordingData | null, Error>
    readonly isRecording: (name: string) => Effect.Effect<boolean, Error>
  }

  export class Service extends Context.Service<Service, Interface>()("@nikcli/Terminal") {}

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const state = yield* InstanceState.make(() =>
        Effect.acquireRelease(
          Effect.sync(() => new SessionManager()),
          (manager) => Effect.sync(() => manager.closeAll()),
        ),
      )

      const tryWith = <A>(label: string, fn: (manager: SessionManager) => A) =>
        Effect.gen(function* () {
          const manager = yield* InstanceState.get(state)
          return yield* Effect.try({
            try: () => fn(manager),
            catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
          })
        }).pipe(Effect.withSpan(`Terminal.${label}`))

      const start: Interface["start"] = (input) =>
        tryWith("start", (manager) => {
          log.info("starting session", { name: input.name, command: input.command })
          return manager.start(input)
        })

      const list: Interface["list"] = () => InstanceState.get(state).pipe(Effect.map((manager) => manager.list()))

      const info: Interface["info"] = (name) => tryWith("info", (m) => m.info(name))

      const send: Interface["send"] = (name, input, mode) => tryWith("send", (m) => m.send(name, input, mode))

      const wait: Interface["wait"] = (name, condition) =>
        Effect.gen(function* () {
          const manager = yield* InstanceState.get(state)
          return yield* Effect.tryPromise({
            try: () => manager.wait(name, condition),
            catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
          })
        }).pipe(Effect.withSpan("Terminal.wait"))

      const resize: Interface["resize"] = (name, cols, rows) => tryWith("resize", (m) => m.resize(name, cols, rows))

      const snapshot: Interface["snapshot"] = (name) => tryWith("snapshot", (m) => m.snapshot(name))

      const render: Interface["render"] = (name, format) =>
        tryWith("render", (m) => renderString(m.snapshot(name), format))

      const renderPngFrame: Interface["renderPng"] = (name) =>
        Effect.gen(function* () {
          const manager = yield* InstanceState.get(state)
          const frame = manager.snapshot(name)
          return yield* Effect.tryPromise({
            try: () => renderPng(frame),
            catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
          })
        }).pipe(Effect.withSpan("Terminal.renderPng"))

      const rawOutput: Interface["rawOutput"] = (name, lines) => tryWith("rawOutput", (m) => m.rawOutput(name, lines))

      const stop: Interface["stop"] = (name) =>
        InstanceState.get(state).pipe(Effect.map((manager) => manager.stop(name)))

      const restart: Interface["restart"] = (name) => tryWith("restart", (m) => m.restart(name))

      const startRecording: Interface["startRecording"] = (name) =>
        tryWith("startRecording", (m) => {
          log.info("start recording", { name })
          m.startRecording(name)
        })
      const marker: Interface["marker"] = (name, markerName) => tryWith("marker", (m) => m.marker(name, markerName))
      const stopRecording: Interface["stopRecording"] = (name) => tryWith("stopRecording", (m) => m.stopRecording(name))
      const recordingData: Interface["recordingData"] = (name) => tryWith("recordingData", (m) => m.recordingData(name))
      const isRecording: Interface["isRecording"] = (name) => tryWith("isRecording", (m) => m.isRecording(name))

      return Service.of({
        start,
        list,
        info,
        send,
        wait,
        resize,
        snapshot,
        render,
        renderPng: renderPngFrame,
        rawOutput,
        stop,
        restart,
        startRecording,
        marker,
        stopRecording,
        recordingData,
        isRecording,
      })
    }),
  )

  export const defaultLayer = layer
}
