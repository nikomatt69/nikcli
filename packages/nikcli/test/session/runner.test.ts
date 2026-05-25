import { describe, expect, it } from "bun:test"
import { Effect } from "effect"
import { make } from "@/session/runner"

describe("Session runner", () => {
  it("runs onIdle when cancel is called while already idle", async () => {
    let idleCount = 0

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const scope = yield* Effect.scope
          const runner = make(scope, {
            onIdle: Effect.sync(() => {
              idleCount++
            }),
          })
          yield* runner.cancel
        }),
      ),
    )

    expect(idleCount).toBe(1)
  })
})
