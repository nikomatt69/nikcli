import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Effect, Layer, Schema } from "effect"
import z from "zod"
import { Bus } from "@/bus"
import { Session } from "@/session"
import { SessionError } from "@/session/error"
import { TuiEvent } from "@/bus/tui-event"
import { TuiConfig } from "@/config/tui"
import { fromZod } from "@/util/zod-effect"
import { TuiControlQueues } from "../tui-control"

export namespace TuiHttpApi {
  const BooleanResult = Schema.Boolean.annotate({
    identifier: "TuiBooleanResult",
  })
  const AnyPayload = Schema.Unknown
  const TuiRequest = Schema.Struct({
    path: Schema.String,
    body: Schema.Unknown,
  }).annotate({ identifier: "TuiControlRequest" })

  /** Payload validation failures return 400 with
   * `{ data, error, success: false }`. */
  const ValidationError = Schema.Struct({
    data: Schema.Unknown,
    error: Schema.Unknown,
    success: Schema.Literal(false),
  }).annotate({ identifier: "TuiValidationError", httpApiStatus: 400 })

  const NotFound = Schema.Struct({
    name: Schema.Literal("NotFoundError"),
    data: Schema.Record(Schema.String, Schema.Unknown),
  }).annotate({ identifier: "TuiNotFoundError", httpApiStatus: 404 })

  /**
   * The merged `tui.json` document, derived from the zod schema that validates the file rather
   * than hand-copied — same treatment as `Config` in `config.ts`, including the open tail.
   *
   * `plugin_meta` is not in the file schema: `TuiConfig.get()` adds it while merging, recording
   * which source each plugin entry came from, and the TUI's plugin runtime reads it.
   */
  const TuiConfigInfo = Schema.StructWithRest(
    Schema.Struct({
      ...(fromZod(TuiConfig.Info) as unknown as Schema.Struct<Schema.Struct.Fields>).fields,
      plugin_meta: Schema.optional(
        Schema.Record(
          Schema.String,
          Schema.Struct({
            scope: Schema.Literals(["global", "local"]),
            source: Schema.String,
          }),
        ),
      ),
    }),
    [Schema.Record(Schema.String, Schema.Unknown)],
  ).annotate({ identifier: "TuiConfig" })

  function parseWith<T>(schema: z.ZodType<T>, payload: unknown) {
    const parsed = schema.safeParse(payload)
    if (parsed.success) return Effect.succeed(parsed.data)
    return Effect.fail({
      data: payload,
      error: parsed.error.issues as unknown,
      success: false as const,
    })
  }

  /** The execute-command alias table from the Hono route, kept verbatim. */
  const commandAliases: Record<string, string> = {
    session_new: "session.new",
    session_share: "session.share",
    session_interrupt: "session.interrupt",
    session_compact: "session.compact",
    messages_page_up: "session.page.up",
    messages_page_down: "session.page.down",
    messages_line_up: "session.line.up",
    messages_line_down: "session.line.down",
    messages_half_page_up: "session.half.page.up",
    messages_half_page_down: "session.half.page.down",
    messages_first: "session.first",
    messages_last: "session.last",
    agent_cycle: "agent.cycle",
  }

  const publishCommand = (command: string) =>
    Effect.promise(() => Bus.publish(TuiEvent.CommandExecute, { command: command as never }))

  export const Group = HttpApiGroup.make("tui")
    .add(
      HttpApiEndpoint.post("appendPrompt", "/append-prompt", {
        payload: AnyPayload,
        success: BooleanResult,
        error: ValidationError,
      }),
    )
    .add(
      HttpApiEndpoint.post("openHelp", "/open-help", {
        success: BooleanResult,
      }),
    )
    .add(
      HttpApiEndpoint.post("openSessions", "/open-sessions", {
        success: BooleanResult,
      }),
    )
    .add(
      HttpApiEndpoint.post("openThemes", "/open-themes", {
        success: BooleanResult,
      }),
    )
    .add(
      HttpApiEndpoint.post("openModels", "/open-models", {
        success: BooleanResult,
      }),
    )
    .add(
      HttpApiEndpoint.post("submitPrompt", "/submit-prompt", {
        success: BooleanResult,
      }),
    )
    .add(
      HttpApiEndpoint.post("clearPrompt", "/clear-prompt", {
        success: BooleanResult,
      }),
    )
    .add(
      HttpApiEndpoint.post("executeCommand", "/execute-command", {
        payload: AnyPayload,
        success: BooleanResult,
        error: ValidationError,
      }),
    )
    .add(
      HttpApiEndpoint.post("showToast", "/show-toast", {
        payload: AnyPayload,
        success: BooleanResult,
        error: ValidationError,
      }),
    )
    .add(
      HttpApiEndpoint.post("publish", "/publish", {
        payload: AnyPayload,
        success: BooleanResult,
        error: ValidationError,
      }),
    )
    .add(
      HttpApiEndpoint.post("selectSession", "/select-session", {
        payload: AnyPayload,
        success: BooleanResult,
        error: [ValidationError, NotFound],
      }),
    )
    .add(
      HttpApiEndpoint.get("config", "/config", {
        success: TuiConfigInfo,
      }).annotate(OpenApi.Identifier, "tui.config"),
    )
    .add(
      HttpApiEndpoint.get("controlNext", "/control/next", {
        success: TuiRequest,
      }).annotate(OpenApi.Identifier, "tui.control.next"),
    )
    .add(
      HttpApiEndpoint.post("controlResponse", "/control/response", {
        payload: AnyPayload,
        success: BooleanResult,
      }).annotate(OpenApi.Identifier, "tui.control.response"),
    )
    .prefix("/tui")

  export const Api = HttpApi.make("nikcli").add(Group)

  export const ApiLive = HttpApiBuilder.layer(Api)

  export const handlers = {
    appendPrompt: ({ payload }: { payload: unknown }) =>
      Effect.gen(function* () {
        const body = yield* parseWith(TuiEvent.PromptAppend.properties, payload)
        yield* Effect.promise(() => Bus.publish(TuiEvent.PromptAppend, body))
        return true
      }),
    openHelp: () => publishCommand("help.show").pipe(Effect.as(true), Effect.orDie),
    openSessions: () => publishCommand("session.list").pipe(Effect.as(true), Effect.orDie),
    openThemes: () => publishCommand("theme.switch").pipe(Effect.as(true), Effect.orDie),
    openModels: () => publishCommand("model.list").pipe(Effect.as(true), Effect.orDie),
    submitPrompt: () => publishCommand("prompt.submit").pipe(Effect.as(true), Effect.orDie),
    clearPrompt: () => publishCommand("prompt.clear").pipe(Effect.as(true), Effect.orDie),
    executeCommand: ({ payload }: { payload: unknown }) =>
      Effect.gen(function* () {
        const body = yield* parseWith(z.object({ command: z.string() }), payload)
        yield* publishCommand(commandAliases[body.command] as string)
        return true
      }),
    showToast: ({ payload }: { payload: unknown }) =>
      Effect.gen(function* () {
        const body = yield* parseWith(TuiEvent.ToastShow.properties, payload)
        yield* Effect.promise(() => Bus.publish(TuiEvent.ToastShow, body))
        return true
      }),
    publish: ({ payload }: { payload: unknown }) =>
      Effect.gen(function* () {
        const record = payload as {
          type?: unknown
          properties?: unknown
        } | null
        const def = Object.values(TuiEvent).find((item) => item.type === record?.type)
        if (!def) {
          return yield* Effect.fail({
            data: payload,
            error: "unknown event type" as unknown,
            success: false as const,
          })
        }
        const body = yield* parseWith(def.properties as z.ZodType<any>, record?.properties)
        yield* Effect.promise(() => Bus.publish(def, body as never))
        return true
      }),
    selectSession: ({ payload }: { payload: unknown }) =>
      Effect.gen(function* () {
        const body = yield* parseWith(TuiEvent.SessionSelect.properties, payload)
        const session = yield* Session.Service
        yield* session.get(body.sessionID).pipe(
          Effect.catch((error) =>
            SessionError.isNotFound(error)
              ? Effect.fail({
                  name: "NotFoundError" as const,
                  data: { message: error.message } as Record<string, unknown>,
                })
              : Effect.die(error),
          ),
          Effect.catchDefect((defect) =>
            SessionError.isNotFound(defect)
              ? Effect.fail({
                  name: "NotFoundError" as const,
                  data: { message: defect.message } as Record<string, unknown>,
                })
              : Effect.die(defect),
          ),
        )
        yield* Effect.promise(() => Bus.publish(TuiEvent.SessionSelect, { sessionID: body.sessionID }))
        return true
      }),
    // Reading it here rather than in the terminal is the point: `TuiConfig.get()` walks the
    // config search path and merges what it finds, which is instance-scoped work.
    //
    // The round-trip through JSON is not decoration. Merging leaves explicitly-`undefined` keys
    // behind, and the response encoder rejects those with "Expected JSON value, got undefined" —
    // a 400 with an empty body, which from the terminal looks exactly like the config being
    // empty. Same treatment as `jsonSafe` in `loop.ts`.
    config: () =>
      Effect.promise(async () => JSON.parse(JSON.stringify((await TuiConfig.get()) ?? null)) as TuiConfig.Info),
    controlNext: () => Effect.promise(() => TuiControlQueues.request.next()),
    controlResponse: ({ payload }: { payload: unknown }) =>
      Effect.sync(() => {
        TuiControlQueues.response.push(payload)
        return true
      }),
  }

  export const HandlersLive = HttpApiBuilder.group(Api, "tui", (builder) =>
    builder
      .handle("appendPrompt", (request) => handlers.appendPrompt(request))
      .handle("openHelp", () => handlers.openHelp())
      .handle("openSessions", () => handlers.openSessions())
      .handle("openThemes", () => handlers.openThemes())
      .handle("openModels", () => handlers.openModels())
      .handle("submitPrompt", () => handlers.submitPrompt())
      .handle("clearPrompt", () => handlers.clearPrompt())
      .handle("executeCommand", (request) => handlers.executeCommand(request))
      .handle("showToast", (request) => handlers.showToast(request))
      .handle("publish", (request) => handlers.publish(request))
      .handle("selectSession", (request) => handlers.selectSession(request))
      .handle("config", () => handlers.config())
      .handle("controlNext", () => handlers.controlNext())
      .handle("controlResponse", (request) => handlers.controlResponse(request)),
  )

  export const DependenciesLive = Session.defaultLayer

  export const layer = ApiLive.pipe(Layer.provide(HandlersLive), Layer.provide(DependenciesLive))
}
