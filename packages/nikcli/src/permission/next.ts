import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { InstanceState } from "@/effect"
import { Identifier } from "@/id/id"
import { Log } from "@/util/log"
import { Wildcard } from "@/util/wildcard"
import { zod, zodObject, type DeepMutable } from "@/util/effect-zod"
import { Context, Effect, Layer, Schema } from "effect"
import z from "zod"
import { PermissionRepo } from "./permission-repo"
import { PermissionRuleset } from "./ruleset"
import { Flag } from "@/flag/flag"

export namespace PermissionNext {
  const log = Log.create({ service: "permission" })

  // Ruleset model + pure evaluator live in ./ruleset so light clients can use
  // them without this module's stateful service chain; re-exported here to
  // keep the PermissionNext API unchanged.
  export const ActionSchema = PermissionRuleset.ActionSchema
  export const Action = PermissionRuleset.Action
  export type Action = PermissionRuleset.Action

  export const RuleSchema = PermissionRuleset.RuleSchema
  export const Rule = PermissionRuleset.Rule
  export type Rule = PermissionRuleset.Rule

  export const RulesetSchema = PermissionRuleset.RulesetSchema
  export const Ruleset = PermissionRuleset.Ruleset
  export type Ruleset = PermissionRuleset.Ruleset

  export const fromConfig = PermissionRuleset.fromConfig
  export const merge = PermissionRuleset.merge
  export const fullAccess = PermissionRuleset.fullAccess

  const RequestSchema = Schema.Struct({
    id: Schema.String.pipe(Schema.check(Schema.isStartsWith("per"))),
    sessionID: Schema.String.pipe(Schema.check(Schema.isStartsWith("ses"))),
    permission: Schema.String,
    patterns: Schema.Array(Schema.String),
    metadata: Schema.Record(Schema.String, Schema.Unknown),
    always: Schema.Array(Schema.String),
    tool: Schema.optional(
      Schema.Struct({
        messageID: Schema.String,
        callID: Schema.String,
      }),
    ),
  }).annotate({ identifier: "PermissionRequest" })
  export const Request = zodObject(RequestSchema)
  export type Request = DeepMutable<Schema.Schema.Type<typeof RequestSchema>>

  const ReplySchema = Schema.Literals(["once", "always", "reject"])
  export const Reply = zod(ReplySchema)
  export type Reply = Schema.Schema.Type<typeof ReplySchema>

  export const Approval = zodObject(
    Schema.Struct({
      projectID: Schema.String,
      patterns: Schema.Array(Schema.String),
    }),
  )

  export const Event = {
    Asked: BusEvent.schema("permission.asked", RequestSchema),
    Replied: BusEvent.schema(
      "permission.replied",
      Schema.Struct({
        sessionID: Schema.String,
        requestID: Schema.String,
        reply: ReplySchema,
      }),
    ),
  }

  type PendingEntry = {
    info: Request
    resolve: () => void
    reject: (e: RejectedError | CorrectedError) => void
  }

  type State = {
    pending: Record<string, PendingEntry>
    approved: Ruleset
  }

  export const AskInput = Request.partial({ id: true }).extend({
    ruleset: Ruleset,
  })
  export type AskInput = z.infer<typeof AskInput>

  export const ReplyInput = z.object({
    requestID: Identifier.schema("permission"),
    reply: Reply,
    message: z.string().optional(),
  })
  export type ReplyInput = z.infer<typeof ReplyInput>

  export interface Interface {
    readonly ask: (input: AskInput) => Effect.Effect<void, DeniedError | RejectedError | CorrectedError>
    readonly reply: (input: ReplyInput) => Effect.Effect<void>
    readonly hydrateAsk: (request: Request) => Effect.Effect<void>
    readonly hydrateReply: (requestID: string) => Effect.Effect<void>
    readonly list: () => Effect.Effect<Request[]>
  }

  export class Service extends Context.Service<Service, Interface>()("@nikcli/PermissionNext") {}

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const state = yield* InstanceState.make<State>((ctx) =>
        Effect.gen(function* () {
          const approved = Effect.sync(() => PermissionRepo.get(ctx.project.id))
          return {
            pending: {},
            approved: yield* approved,
          }
        }),
      )

      const getState = () => InstanceState.get(state)

      const ask = Effect.fn("PermissionNext.ask")(function* (input: AskInput) {
        const parsed = AskInput.parse(input)
        const s = yield* getState()
        const { ruleset, ...request } = parsed
        for (const pattern of request.patterns ?? []) {
          const rule = evaluate(request.permission, pattern, ruleset, s.approved)
          log.info("evaluated", {
            permission: request.permission,
            pattern,
            action: rule,
          })
          if (rule.action === "deny") {
            return yield* Effect.fail(
              new DeniedError({
                ruleset: ruleset.filter((r: Rule) => Wildcard.match(request.permission, r.permission)),
              }),
            )
          }
          if (rule.action === "ask") {
            // Opencode #22047: --dangerously-skip-permissions auto-approves `ask` rules
            // after the deny check. Deny rules still throw DeniedError (above).
            if (Flag.NIKCLI_DANGEROUSLY_SKIP_PERMISSIONS) {
              log.warn("dangerously skipping ask rule", {
                permission: request.permission,
                pattern,
              })
              continue
            }
            const id = parsed.id ?? Identifier.ascending("permission")
            return yield* Effect.callback<void, RejectedError | CorrectedError>((resume) => {
              const info: Request = {
                id,
                ...request,
              }
              s.pending[id] = {
                info,
                resolve: () => resume(Effect.void),
                reject: (error: RejectedError | CorrectedError) => resume(Effect.fail(error)),
              }
              void Bus.publish(Event.Asked, info)
              return Effect.sync(() => {
                delete s.pending[id]
              })
            })
          }
          if (rule.action === "allow") continue
        }
      })

      const reply = Effect.fn("PermissionNext.reply")(function* (input: ReplyInput) {
        const parsed = ReplyInput.parse(input)
        const s = yield* getState()
        const existing = s.pending[parsed.requestID]
        if (!existing) return
        delete s.pending[parsed.requestID]
        yield* Effect.promise(() =>
          Bus.publish(Event.Replied, {
            sessionID: existing.info.sessionID,
            requestID: existing.info.id,
            reply: parsed.reply,
          }),
        )
        if (parsed.reply === "reject") {
          existing.reject(parsed.message ? new CorrectedError({ feedback: parsed.message }) : new RejectedError({}))
          const sessionID = existing.info.sessionID
          for (const [id, pending] of Object.entries(s.pending)) {
            if (pending.info.sessionID === sessionID) {
              delete s.pending[id]
              yield* Effect.promise(() =>
                Bus.publish(Event.Replied, {
                  sessionID: pending.info.sessionID,
                  requestID: pending.info.id,
                  reply: "reject",
                }),
              )
              pending.reject(new RejectedError({}))
            }
          }
          return
        }
        if (parsed.reply === "once") {
          existing.resolve()
          return
        }
        if (parsed.reply === "always") {
          for (const pattern of existing.info.always) {
            const rule: Rule = {
              permission: existing.info.permission,
              pattern,
              action: "allow",
            }
            s.approved.push(rule)
          }
          const ctx = yield* InstanceState.context
          Effect.runSync(Effect.sync(() => PermissionRepo.upsert(ctx.project.id, s.approved)))

          existing.resolve()

          const sessionID = existing.info.sessionID
          for (const [id, pending] of Object.entries(s.pending)) {
            if (pending.info.sessionID !== sessionID) continue
            const ok = pending.info.patterns.every(
              (pattern: string) => evaluate(pending.info.permission, pattern, s.approved).action === "allow",
            )
            if (!ok) continue
            delete s.pending[id]
            yield* Effect.promise(() =>
              Bus.publish(Event.Replied, {
                sessionID: pending.info.sessionID,
                requestID: pending.info.id,
                reply: "always",
              }),
            )
            pending.resolve()
          }
        }
      })

      const hydrateAsk = Effect.fn("PermissionNext.hydrateAsk")(function* (request: Request) {
        const s = yield* getState()
        s.pending[request.id] = {
          info: request,
          resolve: () => {},
          reject: () => {},
        }
      })

      const hydrateReply = Effect.fn("PermissionNext.hydrateReply")(function* (requestID: string) {
        const s = yield* getState()
        delete s.pending[requestID]
      })

      const list = Effect.fn("PermissionNext.list")(function* () {
        const s = yield* getState()
        return Object.values(s.pending).map((x) => x.info)
      })

      return Service.of({
        ask,
        reply,
        hydrateAsk,
        hydrateReply,
        list,
      })
    }),
  )

  export const defaultLayer = layer

  export const evaluate = PermissionRuleset.evaluate
  export const disabled = PermissionRuleset.disabled

  export class RejectedError extends Schema.TaggedErrorClass<RejectedError>()("PermissionRejectedError", {}) {
    override get message() {
      return "The user rejected permission to use this specific tool call."
    }
  }

  export class CorrectedError extends Schema.TaggedErrorClass<CorrectedError>()("PermissionCorrectedError", {
    feedback: Schema.String,
  }) {
    override get message() {
      return `The user rejected permission to use this specific tool call with the following feedback: ${this.feedback}`
    }
  }

  export class DeniedError extends Schema.TaggedErrorClass<DeniedError>()("PermissionDeniedError", {
    ruleset: Schema.Any,
  }) {
    override get message() {
      return `The user has specified a rule which prevents you from using this specific tool call. Here are some of the relevant rules ${JSON.stringify(this.ruleset)}`
    }
  }
}
