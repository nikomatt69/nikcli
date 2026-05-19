import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { Config } from "@/config/config"
import { InstanceState } from "@/effect"
import { Identifier } from "@/id/id"
import { Storage } from "@/storage/storage"
import { Log } from "@/util/log"
import { Wildcard } from "@/util/wildcard"
import { zod, zodObject } from "@/util/effect-zod"
import { Context, Effect, Layer, Schema } from "effect"
import os from "os"
import z from "zod"

export namespace PermissionNext {
  const log = Log.create({ service: "permission" })

  function expand(pattern: string): string {
    if (pattern.startsWith("~/")) return os.homedir() + pattern.slice(1)
    if (pattern === "~") return os.homedir()
    if (pattern.startsWith("$HOME/")) return os.homedir() + pattern.slice(5)
    if (pattern.startsWith("$HOME")) return os.homedir() + pattern.slice(5)
    return pattern
  }

  export const ActionSchema = Schema.Literals(["allow", "deny", "ask"]).annotate({
    identifier: "PermissionAction",
  })
  export const Action = zod(ActionSchema)
  export type Action = Schema.Schema.Type<typeof ActionSchema>

  export const RuleSchema = Schema.Struct({
    permission: Schema.String,
    pattern: Schema.String,
    action: ActionSchema,
  }).annotate({ identifier: "PermissionRule" })
  export const Rule = zodObject(RuleSchema)
  export type Rule = Schema.Schema.Type<typeof RuleSchema>

  export const RulesetSchema = Schema.mutable(Schema.Array(RuleSchema)).annotate({
    identifier: "PermissionRuleset",
  })
  export const Ruleset = zod(RulesetSchema)
  export type Ruleset = Schema.Schema.Type<typeof RulesetSchema>

  export function fromConfig(permission: Config.Permission) {
    const ruleset: Ruleset = []
    for (const [key, value] of Object.entries(permission)) {
      if (typeof value === "string") {
        ruleset.push({
          permission: key,
          action: value,
          pattern: "*",
        })
        continue
      }
      ruleset.push(
        ...Object.entries(value).map(([pattern, action]) => ({ permission: key, pattern: expand(pattern), action })),
      )
    }
    return ruleset
  }

  export function merge(...rulesets: Ruleset[]): Ruleset {
    return rulesets.flat()
  }

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
  export type Request = Schema.Schema.Type<typeof RequestSchema>

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
    Asked: BusEvent.define("permission.asked", Request),
    Replied: BusEvent.define(
      "permission.replied",
      z.object({
        sessionID: z.string(),
        requestID: z.string(),
        reply: Reply,
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

  function storageRead<T>(key: string[]) {
    return Effect.provide(
      Effect.gen(function* () {
        const storage = yield* Storage.Service
        return yield* storage.read<T>(key)
      }),
      Storage.defaultLayer,
    )
  }

  function storageWrite<T>(key: string[], content: T) {
    return Effect.provide(
      Effect.gen(function* () {
        const storage = yield* Storage.Service
        yield* storage.write(key, content)
      }),
      Storage.defaultLayer,
    )
  }

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const state = yield* InstanceState.make<State>((ctx) =>
        Effect.gen(function* () {
          const approved = yield* storageRead<Ruleset>(["permission", ctx.project.id]).pipe(
            Effect.catch(() => Effect.succeed([] as Ruleset)),
          )
          return {
            pending: {},
            approved,
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
          log.info("evaluated", { permission: request.permission, pattern, action: rule })
          if (rule.action === "deny") {
            return yield* Effect.fail(
              new DeniedError({
                ruleset: ruleset.filter((r: Rule) => Wildcard.match(request.permission, r.permission)),
              }),
            )
          }
          if (rule.action === "ask") {
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
          yield* storageWrite(["permission", ctx.project.id], s.approved).pipe(Effect.orDie)

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

  export function evaluate(permission: string, pattern: string, ...rulesets: Ruleset[]): Rule {
    const merged = merge(...rulesets)
    log.info("evaluate", { permission, pattern, ruleset: merged })
    const match = merged.findLast(
      (rule: Rule) => Wildcard.match(permission, rule.permission) && Wildcard.match(pattern, rule.pattern),
    )
    return match ?? { action: "ask", permission, pattern: "*" }
  }

  const EDIT_TOOLS = ["edit", "write", "patch", "multiedit"]

  export function disabled(tools: string[], ruleset: Ruleset): Set<string> {
    const result = new Set<string>()
    for (const tool of tools) {
      const permission = EDIT_TOOLS.includes(tool) ? "edit" : tool

      const rule = ruleset.findLast((r: Rule) => Wildcard.match(permission, r.permission))
      if (!rule) continue
      if (rule.pattern === "*" && rule.action === "deny") result.add(tool)
    }
    return result
  }

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
