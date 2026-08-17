import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Effect, Layer, Schema } from "effect"
import z from "zod"
import { Bus } from "@/bus"
import { Session } from "@/session"
import { SessionError } from "@/session/error"
import { TuiEvent } from "@/bus/tui-event"
import { TuiEventPayload, TuiEventZod } from "@nikcli-ai/util/tui-event-schema"
import { TuiConfig } from "@/config/tui"
import { fromZod } from "@/util/zod-effect"
import { TuiControlQueues } from "../tui-control"

export namespace TuiHttpApi {
  const BooleanResult = Schema.Boolean.annotate({
    identifier: "TuiBooleanResult",
  })
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

  // Typed payload schemas for the six endpoints that previously declared
  // `payload: Schema.Unknown`. Each one is the same shape the handler would
  // have parsed through zod — lifted to Effect so the encoder rejects a
  // malformed write before the handler runs, and the generated SDK can
  // describe the body instead of publishing `any`.
  const AppendPromptPayload = TuiEventPayload.promptAppend.annotate({
    identifier: "TuiAppendPromptInput",
  })
  const ExecuteCommandPayload = Schema.Struct({
    command: Schema.String,
  }).annotate({ identifier: "TuiExecuteCommandInput" })
  const ShowToastPayload = TuiEventPayload.toastShow.annotate({
    identifier: "TuiShowToastInput",
  })
  // Publish is a discriminated envelope: the event type is the discriminator
  // and the properties shape is event-specific. The terminal is the authority
  // on the per-event shape, so the wire contract here is the resolved payload
  // the handler will pass to `Bus.publish`. Use `Schema.Unknown` for `properties`
  // because the runtime check on `type` decides which `TuiEventPayload` to
  // parse against.
  const PublishPayload = Schema.Struct({
    type: Schema.String,
    properties: Schema.Unknown,
  }).annotate({ identifier: "TuiPublishInput" })
  const SelectSessionPayload = TuiEventPayload.sessionSelect.annotate({
    identifier: "TuiSelectSessionInput",
  })
  const ControlResponsePayload = Schema.Struct({
    path: Schema.String,
    body: Schema.Unknown,
  }).annotate({ identifier: "TuiControlResponseInput" })

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
      plugin_meta: Schema.optionalKey(
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
        payload: AppendPromptPayload,
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
        payload: ExecuteCommandPayload,
        success: BooleanResult,
        error: ValidationError,
      }),
    )
    .add(
      HttpApiEndpoint.post("showToast", "/show-toast", {
        payload: ShowToastPayload,
        success: BooleanResult,
        error: ValidationError,
      }),
    )
    .add(
      HttpApiEndpoint.post("publish", "/publish", {
        payload: PublishPayload,
        success: BooleanResult,
        error: ValidationError,
      }),
    )
    .add(
      HttpApiEndpoint.post("selectSession", "/select-session", {
        payload: SelectSessionPayload,
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
        payload: ControlResponsePayload,
        success: BooleanResult,
      }).annotate(OpenApi.Identifier, "tui.control.response"),
    )
    .prefix("/tui")

  export const Api = HttpApi.make("nikcli").add(Group)

  export const ApiLive = HttpApiBuilder.layer(Api)

  export const handlers = {
    appendPrompt: ({ payload }: { payload: typeof AppendPromptPayload.Type }) =>
      Effect.promise(() => Bus.publish(TuiEvent.PromptAppend, payload as never)).pipe(Effect.as(true)),
    openHelp: () => publishCommand("help.show").pipe(Effect.as(true), Effect.orDie),
    openSessions: () => publishCommand("session.list").pipe(Effect.as(true), Effect.orDie),
    openThemes: () => publishCommand("theme.switch").pipe(Effect.as(true), Effect.orDie),
    openModels: () => publishCommand("model.list").pipe(Effect.as(true), Effect.orDie),
    submitPrompt: () => publishCommand("prompt.submit").pipe(Effect.as(true), Effect.orDie),
    clearPrompt: () => publishCommand("prompt.clear").pipe(Effect.as(true), Effect.orDie),
    executeCommand: ({ payload }: { payload: typeof ExecuteCommandPayload.Type }) => {
      const cmd = commandAliases[payload.command] ?? payload.command
      return publishCommand(cmd).pipe(Effect.as(true), Effect.orDie)
    },
    showToast: ({ payload }: { payload: typeof ShowToastPayload.Type }) =>
      // The zod side `default(5000)` for `duration` lives on `TuiEventZod`;
      // apply it here so the wire contract still matches the legacy body the
      // terminal sends (no `duration` field → 5000ms).
      Effect.promise(async () => {
        const parsed = TuiEventZod.toastShow.parse(payload)
        await Bus.publish(TuiEvent.ToastShow, parsed as never)
        return true as const
      }),
    publish: ({ payload }: { payload: typeof PublishPayload.Type }) =>
      Effect.gen(function* () {
        const def = Object.values(TuiEvent).find((item) => item.type === payload.type)
        if (!def) {
          return yield* Effect.fail({
            data: payload,
            error: "unknown event type" as unknown,
            success: false as const,
          })
        }
        // `properties` is event-specific; the per-event zod schema is the
        // authority (the terminal uses it too). The schema lives on the
        // bus event itself, so we run it through that.
        const body = yield* Effect.try({
          try: () => (def.properties as z.ZodType<unknown>).parse(payload.properties),
          catch: (error) => ({
            data: payload,
            error: (error as Error).message as unknown,
            success: false as const,
          }),
        })
        yield* Effect.promise(() => Bus.publish(def, body as never))
        return true
      }),
    selectSession: ({ payload }: { payload: typeof SelectSessionPayload.Type }) =>
      Effect.gen(function* () {
        const session = yield* Session.Service
        yield* session.get(payload.sessionID).pipe(
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
        yield* Effect.promise(() => Bus.publish(TuiEvent.SessionSelect, { sessionID: payload.sessionID }))
        return true
      }),
    // Reading it here rather than in the terminal is the point: `TuiConfig.get()` walks the
    // config search path and merges what it finds, which is instance-scoped work.
    //
    // The bound `TuiConfigInfo` schema uses `Schema.optionalKey` everywhere a
    // merged-in key can be absent, so the encoder accepts the result and does
    // not need a `JSON.parse(JSON.stringify(...))` round-trip — the same
    // treatment that landed across `loop.ts`, `mission.ts`, `provider.ts`,
    // and `session.ts`.
    config: () => Effect.promise(() => TuiConfig.get()),
    controlNext: () => Effect.promise(() => TuiControlQueues.request.next()),
    controlResponse: ({ payload }: { payload: typeof ControlResponsePayload.Type }) =>
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
