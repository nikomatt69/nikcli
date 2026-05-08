import { Identifier } from "../id/id"
import { Snapshot } from "../snapshot"
import { MessageV2 } from "./message-v2"
import { Session } from "."
import { Log } from "../util/log"
import { Storage } from "../storage/storage"
import { Bus } from "../bus"
import { SessionPrompt } from "./prompt"
import { SessionSummary } from "./summary"
import { zodObject } from "@/util/effect-zod"
import { Context, Effect, Layer, Schema } from "effect"
import { runPromiseWithLayer, withCurrentInstance } from "@/effect"

export namespace SessionRevert {
  const log = Log.create({ service: "session.revert" })

  function runSnapshot<A, E>(effect: Effect.Effect<A, E, Snapshot.Service>) {
    return runPromiseWithLayer(Snapshot.defaultLayer, withCurrentInstance(effect))
  }

  function runSummary<A, E>(effect: Effect.Effect<A, E, SessionSummary.Service>) {
    return runPromiseWithLayer(SessionSummary.defaultLayer, withCurrentInstance(effect))
  }

  function runSessionPrompt<A, E>(effect: Effect.Effect<A, E, SessionPrompt.Service>) {
    return runPromiseWithLayer(SessionPrompt.defaultLayer, withCurrentInstance(effect))
  }

  function runSession<A, E>(effect: Effect.Effect<A, E, Session.Service>) {
    return runPromiseWithLayer(Session.defaultLayer, withCurrentInstance(effect))
  }

  function runStorage<A, E>(effect: Effect.Effect<A, E, Storage.Service>) {
    return runPromiseWithLayer(Storage.defaultLayer, effect)
  }

  function storageWrite<T>(key: string[], content: T) {
    return runStorage(
      Effect.gen(function* () {
        const storage = yield* Storage.Service
        yield* storage.write(key, content)
      }),
    )
  }

  function storageRemove(key: string[]) {
    return runStorage(
      Effect.gen(function* () {
        const storage = yield* Storage.Service
        yield* storage.remove(key)
      }),
    )
  }

  const RevertInputSchema = Schema.Struct({
    sessionID: Schema.String.pipe(Schema.startsWith("ses")),
    messageID: Schema.String.pipe(Schema.startsWith("msg")),
    partID: Schema.optional(Schema.String.pipe(Schema.startsWith("prt"))),
  })
  export const RevertInput = zodObject(RevertInputSchema)
  export type RevertInput = Schema.Schema.Type<typeof RevertInputSchema>

  export interface Interface {
    revert(input: RevertInput): Effect.Effect<Session.Info, unknown>
    unrevert(input: { sessionID: string }): Effect.Effect<Session.Info, unknown>
    cleanup(session: Session.Info): Effect.Effect<void, unknown>
  }

  export class Service extends Context.Tag("SessionRevert.Service")<Service, Interface>() {}

  async function revertImpl(input: RevertInput) {
    await runSessionPrompt(
      Effect.gen(function* () {
        const prompt = yield* SessionPrompt.Service
        yield* prompt.assertNotBusy(input.sessionID)
      }),
    )
    const { all, session } = await runSession(
      Effect.gen(function* () {
        const sessionService = yield* Session.Service
        const all = yield* sessionService.messages({ sessionID: input.sessionID })
        const session = yield* sessionService.get(input.sessionID)
        return { all, session }
      }),
    )
    let lastUser: MessageV2.User | undefined

    let revert: Session.Info["revert"]
    const patches: Snapshot.Patch[] = []
    for (const msg of all) {
      if (msg.info.role === "user") lastUser = msg.info
      const remaining = []
      for (const part of msg.parts) {
        if (revert) {
          if (part.type === "patch") {
            patches.push(part)
          }
          continue
        }

        if (!revert) {
          if ((msg.info.id === input.messageID && !input.partID) || part.id === input.partID) {
            const partID = remaining.some((item) => ["text", "tool"].includes(item.type)) ? input.partID : undefined
            revert = {
              messageID: !partID && lastUser ? lastUser.id : msg.info.id,
              partID,
            }
          }
          remaining.push(part)
        }
      }
    }

    if (revert) {
      const current = await runSession(
        Effect.gen(function* () {
          const sessionService = yield* Session.Service
          return yield* sessionService.get(input.sessionID)
        }),
      )
      revert.snapshot =
        current.revert?.snapshot ??
        (await runSnapshot(
          Effect.gen(function* () {
            const snapshot = yield* Snapshot.Service
            return yield* snapshot.track()
          }),
        ))
      await runSnapshot(
        Effect.gen(function* () {
          const snapshot = yield* Snapshot.Service
          yield* snapshot.revert(patches)
        }),
      )
      if (revert.snapshot) {
        revert.diff = await runSnapshot(
          Effect.gen(function* () {
            const snapshot = yield* Snapshot.Service
            return yield* snapshot.diff(revert.snapshot!)
          }),
        )
      }
      const rangeMessages = all.filter((msg) => msg.info.id >= revert!.messageID)
      const diffs = await runSummary(
        Effect.gen(function* () {
          const summary = yield* SessionSummary.Service
          return yield* summary.computeDiff({ messages: rangeMessages })
        }),
      )
      await storageWrite(["session_diff", input.sessionID], diffs)
      Bus.publish(Session.Event.Diff, {
        sessionID: input.sessionID,
        diff: diffs,
      })
      return runSession(
        Effect.gen(function* () {
          const sessionService = yield* Session.Service
          return yield* sessionService.update(input.sessionID, (draft) => {
            draft.revert = revert
            draft.summary = {
              additions: diffs.reduce((sum, x) => sum + x.additions, 0),
              deletions: diffs.reduce((sum, x) => sum + x.deletions, 0),
              files: diffs.length,
            }
          })
        }),
      )
    }
    return session
  }

  async function unrevertImpl(input: { sessionID: string }) {
    log.info("unreverting", input)
    await runSessionPrompt(
      Effect.gen(function* () {
        const prompt = yield* SessionPrompt.Service
        yield* prompt.assertNotBusy(input.sessionID)
      }),
    )
    const session = await runSession(
      Effect.gen(function* () {
        const sessionService = yield* Session.Service
        return yield* sessionService.get(input.sessionID)
      }),
    )
    if (!session.revert) return session
    if (session.revert.snapshot) {
      await runSnapshot(
        Effect.gen(function* () {
          const snapshot = yield* Snapshot.Service
          yield* snapshot.restore(session.revert!.snapshot!)
        }),
      )
    }
    const next = await runSession(
      Effect.gen(function* () {
        const sessionService = yield* Session.Service
        return yield* sessionService.update(input.sessionID, (draft) => {
          draft.revert = undefined
        })
      }),
    )
    return next
  }

  async function cleanupImpl(session: Session.Info) {
    if (!session.revert) return
    const sessionID = session.id
    const messageID = session.revert.messageID
    const msgs = await runSession(
      Effect.gen(function* () {
        const sessionService = yield* Session.Service
        return yield* sessionService.messages({ sessionID })
      }),
    )
    const targetIndex = msgs.findIndex((x) => x.info.id === messageID)
    if (targetIndex === -1) {
      await runSession(
        Effect.gen(function* () {
          const sessionService = yield* Session.Service
          yield* sessionService.update(sessionID, (draft) => {
            draft.revert = undefined
          })
        }),
      )
      return
    }

    const removeStart = session.revert.partID ? targetIndex + 1 : targetIndex
    for (const msg of msgs.slice(removeStart)) {
      await runSession(
        Effect.gen(function* () {
          const sessionService = yield* Session.Service
          yield* sessionService.removeMessage({ sessionID, messageID: msg.info.id })
        }),
      )
    }

    const target = msgs[targetIndex]
    if (session.revert.partID && target) {
      const partID = session.revert.partID
      const partIndex = target.parts.findIndex((x) => x.id === partID)
      const removeParts = partIndex === -1 ? [] : target.parts.slice(partIndex)
      for (const part of removeParts) {
        await storageRemove(["part", target.info.id, part.id])
        await Bus.publish(MessageV2.Event.PartRemoved, {
          sessionID: sessionID,
          messageID: target.info.id,
          partID: part.id,
        })
      }
    }
    await runSession(
      Effect.gen(function* () {
        const sessionService = yield* Session.Service
        yield* sessionService.update(sessionID, (draft) => {
          draft.revert = undefined
        })
      }),
    )
  }

  const layer = Layer.succeed(
    Service,
    Service.of({
      revert: (input) => Effect.tryPromise(() => revertImpl(input)),
      unrevert: (input) => Effect.tryPromise(() => unrevertImpl(input)),
      cleanup: (session) => Effect.tryPromise(() => cleanupImpl(session)),
    }),
  )

  export const defaultLayer = layer
}
