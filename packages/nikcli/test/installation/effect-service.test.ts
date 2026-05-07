import { describe, expect, it } from "bun:test"
import { Installation } from "@/installation"
import { runPromiseWithLayer } from "@/effect"
import { Effect } from "effect"

function runInstallation<A, E>(effect: Effect.Effect<A, E, Installation.Service>) {
  return runPromiseWithLayer(Installation.defaultLayer, effect)
}

describe("Installation.Service", () => {
  it("provides the installation operations through the Effect service boundary", async () => {
    const operations = await runInstallation(
      Effect.gen(function* () {
        const installation = yield* Installation.Service
        return {
          info: typeof installation.info,
          latest: typeof installation.latest,
          method: typeof installation.method,
          upgrade: typeof installation.upgrade,
        }
      }),
    )

    expect(operations).toEqual({
      info: "function",
      latest: "function",
      method: "function",
      upgrade: "function",
    })
  })
})
