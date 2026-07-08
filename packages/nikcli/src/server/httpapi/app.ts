import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi"
import { Effect, Layer, Schema } from "effect"
import { Log } from "@/util/log"
import { Skill } from "@/skill"

/**
 * Effect backend for the app-scoped routes that previously only had Hono
 * registrations in `server.ts` (Wave 3b closure). Mirrors:
 *  - `POST /log`     (operationId `app.log`)
 *  - `POST /skill`   (operationId `app.skill.create`)
 *  - `DELETE /skill/:name` (operationId `app.skill.delete`)
 *
 * Read-only app routes (`/agent`, `GET /skill`, `/lsp`, `/formatter`,
 * `/instance/dispose`, `/path`, `/vcs/...`, `/command`) stay on the
 * `top-level` group — see `httpapi/top-level.ts`.
 */
export namespace AppHttpApi {
  const LogInput = Schema.Struct({
    service: Schema.String.annotate({
      description: "Service name for the log entry",
    }),
    level: Schema.Literals(["debug", "info", "error", "warn"]).annotate({
      description: "Log level",
    }),
    message: Schema.String.annotate({ description: "Log message" }),
    extra: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)).annotate({
      description: "Additional metadata for the log entry",
    }),
  }).annotate({ identifier: "AppLogInput" })

  const SkillCreateInput = Schema.Struct({
    name: Schema.String.annotate({
      description: "Skill name (kebab-case recommended)",
    }),
    description: Schema.String.annotate({
      description: "Short description of the skill",
    }),
    category: Schema.optional(Schema.String).annotate({
      description: "Optional category",
    }),
    tags: Schema.optional(Schema.Array(Schema.String)).annotate({
      description: "Optional tags",
    }),
    content: Schema.optional(Schema.String).annotate({
      description: "Optional markdown content body",
    }),
    scope: Schema.optional(Schema.Literals(["workspace", "global"])).annotate({
      description: "Where to create the skill (default workspace)",
    }),
  }).annotate({ identifier: "AppSkillCreateInput" })

  const SkillInfo = Schema.Struct({
    name: Schema.String,
    description: Schema.String,
    location: Schema.String,
    category: Schema.optional(Schema.String),
    tags: Schema.optional(Schema.Array(Schema.String)),
    version: Schema.optional(Schema.String),
  }).annotate({ identifier: "AppSkillInfo" })

  const SkillNameParam = Schema.Struct({
    name: Schema.String,
  }).annotate({ identifier: "AppSkillNameParam" })

  export const Group = HttpApiGroup.make("app")
    .add(
      HttpApiEndpoint.post("log", "/log", {
        payload: LogInput,
        success: Schema.Boolean,
      }),
    )
    .add(
      HttpApiEndpoint.post("skillCreate", "/skill", {
        payload: SkillCreateInput,
        success: SkillInfo,
      }),
    )
    .add(
      HttpApiEndpoint.delete("skillDelete", "/skill/:name", {
        params: SkillNameParam,
        success: Schema.Boolean,
      }),
    )

  export const Api = HttpApi.make("nikcli").add(Group)
  export const ApiLive = HttpApiBuilder.layer(Api)

  /**
   * `Log.create` is a synchronous factory — wrap the side-effecting debug/info/etc.
   * call in `Effect.sync` so the handler yields a lawful `Effect`.
   */
  export const handlers = {
    log: ({ payload }: { payload: typeof LogInput.Type }) =>
      Effect.sync(() => {
        const logger = Log.create({ service: payload.service })
        switch (payload.level) {
          case "debug":
            logger.debug(payload.message, payload.extra as Record<string, unknown> | undefined)
            return true
          case "info":
            logger.info(payload.message, payload.extra as Record<string, unknown> | undefined)
            return true
          case "error":
            logger.error(payload.message, payload.extra as Record<string, unknown> | undefined)
            return true
          case "warn":
            logger.warn(payload.message, payload.extra as Record<string, unknown> | undefined)
            return true
        }
      }),

    skillCreate: ({ payload }: { payload: typeof SkillCreateInput.Type }) =>
      Effect.gen(function* () {
        const service = yield* Skill.Service
        // The HttpApi schema mirrors Skill.CreateInput's decoded shape;
        // the service accepts the same decoded payload (it re-parses
        // through its own zodObject internally so the unknown fields
        // are validated at the seam).
        return yield* service.create(payload as unknown as Parameters<typeof service.create>[0])
      }).pipe(Effect.orDie),

    skillDelete: ({ params }: { params: typeof SkillNameParam.Type }) =>
      Effect.gen(function* () {
        const service = yield* Skill.Service
        yield* service.remove(params.name)
      }).pipe(Effect.as(true), Effect.orDie),
  }

  export const HandlersLive = HttpApiBuilder.group(Api, "app", (builder) =>
    builder
      .handle("log", (request) => handlers.log(request))
      .handle("skillCreate", (request) => handlers.skillCreate(request))
      .handle("skillDelete", (request) => handlers.skillDelete(request)),
  )

  export const DependenciesLive = Skill.defaultLayer

  export const layer = ApiLive.pipe(Layer.provide(HandlersLive), Layer.provide(DependenciesLive))
}
