import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { Config } from "@/config/config"
import { InstanceState } from "@/effect"
import { Identifier } from "@/id/id"
import { Storage } from "@/storage/storage"
import { Log } from "@/util/log"
import { Wildcard } from "@/util/wildcard"
import { Context, Effect, Layer } from "effect"
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

  export const Action = z.enum(["allow", "deny", "ask"]).meta({
    ref: "PermissionAction",
  })
  export type Action = z.infer<typeof Action>

  export const Rule = z
    .object({
      permission: z.string(),
      pattern: z.string(),
      action: Action,
    })
    .meta({
      ref: "PermissionRule",
    })
  export type Rule = z.infer<typeof Rule>

  export const Ruleset = Rule.array().meta({
    ref: "PermissionRuleset",
  })
  export type Ruleset = z.infer<typeof Ruleset>

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

  export const Request = z
    .object({
      id: Identifier.schema("permission"),
      sessionID: Identifier.schema("session"),
      permission: z.string(),
      patterns: z.string().array(),
      metadata: z.record(z.string(), z.any()),
      always: z.string().array(),
      tool: z
        .object({
          messageID: z.string(),
          callID: z.string(),
        })
        .optional(),
    })
    .meta({
      ref: "PermissionRequest",
    })

  export type Request = z.infer<typeof Request>

  export const Reply = z.enum(["once", "always", "reject"])
  export type Reply = z.infer<typeof Reply>

  export const Approval = z.object({
    projectID: z.string(),
    patterns: z.string().array(),
  })

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
    reject: (e: Error) => void
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

  export class Service extends Context.Tag("@nikcli/PermissionNext")<Service, Interface>() {}

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

  export const layer = Layer.scoped(
    Service,
    Effect.gen(function* () {
      const state = yield* InstanceState.make<State>((ctx) =>
        Effect.gen(function* () {
          const approved = yield* storageRead<Ruleset>(["permission", ctx.project.id]).pipe(
            Effect.catchAll(() => Effect.succeed([] as Ruleset)),
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
              new DeniedError(ruleset.filter((r) => Wildcard.match(request.permission, r.permission))),
            )
          }
          if (rule.action === "ask") {
            const id = parsed.id ?? Identifier.ascending("permission")
            return yield* Effect.async<void, RejectedError | CorrectedError>((resume) => {
              const info: Request = {
                id,
                ...request,
              }
              s.pending[id] = {
                info,
                resolve: () => resume(Effect.void),
                reject: (error) => resume(Effect.fail(error)),
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
          existing.reject(parsed.message ? new CorrectedError(parsed.message) : new RejectedError())
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
              pending.reject(new RejectedError())
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
              (pattern) => evaluate(pending.info.permission, pattern, s.approved).action === "allow",
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
      (rule) => Wildcard.match(permission, rule.permission) && Wildcard.match(pattern, rule.pattern),
    )
    return match ?? { action: "ask", permission, pattern: "*" }
  }

  const EDIT_TOOLS = ["edit", "write", "patch", "multiedit"]

  export function disabled(tools: string[], ruleset: Ruleset): Set<string> {
    const result = new Set<string>()
    for (const tool of tools) {
      const permission = EDIT_TOOLS.includes(tool) ? "edit" : tool

      const rule = ruleset.findLast((r) => Wildcard.match(permission, r.permission))
      if (!rule) continue
      if (rule.pattern === "*" && rule.action === "deny") result.add(tool)
    }
    return result
  }

  export class RejectedError extends Error {
    constructor() {
      super(`The user rejected permission to use this specific tool call.`)
    }
  }

  export class CorrectedError extends Error {
    constructor(message: string) {
      super(`The user rejected permission to use this specific tool call with the following feedback: ${message}`)
    }
  }

  export class DeniedError extends Error {
    constructor(public readonly ruleset: Ruleset) {
      super(
        `The user has specified a rule which prevents you from using this specific tool call. Here are some of the relevant rules ${JSON.stringify(ruleset)}`,
      )
    }
  }

}
