import { describe, expect, it } from "bun:test"
import { Effect, Layer } from "effect"
import { SRC, stripComments } from "../tui/tui-source"

/**
 * `runPromiseWithLayer` requires the layer to provide what the effect asks for.
 *
 * It used to take `Layer.Layer<any, LE, never>` and cast the effect to
 * `Effect<A, E, any>`, so every mismatch compiled. Four modules exploited that
 * without meaning to: they declared effects needing `Snapshot.Service` and ran
 * them on `SessionSummary.defaultLayer`, which reaches Snapshot through
 * `Layer.provide` — consumed as a dependency, not re-exported. The first effect
 * to actually touch it would have failed at runtime.
 *
 * Types are checked by `bun run typecheck`, not here. What this file guards is
 * the pair of properties that made the mistake invisible and would make it
 * invisible again: the signature must not reintroduce `any`, and the merged
 * layer must be a stable value so the runtime cache can key on it.
 *
 * `specs/effect-tui/02-effect-boundaries.md`.
 */

describe("runPromiseWithLayer typing", () => {
  it("does not erase the layer's provided services with any", async () => {
    const source = stripComments(await Bun.file(SRC + "effect/runtime.ts").text())

    const signature = source.slice(
      source.indexOf("export function runPromiseWithLayer"),
      source.indexOf("export function withCurrentInstance"),
    )

    expect(signature).not.toContain("Layer.Layer<any")
    expect(signature).not.toContain("Effect.Effect<A, E, any>")
    expect(signature).toContain("R extends ROut")
  })

  it("keeps the summary runner layer a stable value", async () => {
    const { SessionSummary } = await import("@/session/summary")

    // `runtimeFor` memoizes runtimes in a WeakMap keyed by layer identity. A
    // layer rebuilt per call would build a runtime per call, which is why the
    // four call sites share one constant instead of calling Layer.mergeAll.
    expect(SessionSummary.runnerLayer).toBe(SessionSummary.runnerLayer)
    expect(Layer.isLayer(SessionSummary.runnerLayer)).toBe(true)
  })

  it("provides Session and Snapshot alongside the summary service", async () => {
    const { SessionSummary } = await import("@/session/summary")
    const { Session } = await import("@/session")
    const { Snapshot } = await import("@/snapshot")

    // Resolving all three off one layer is the property the four `runSummary`
    // helpers depend on; `defaultLayer` alone satisfies only the first.
    const resolved = await Effect.gen(function* () {
      return {
        summary: yield* Effect.serviceOption(SessionSummary.Service),
        session: yield* Effect.serviceOption(Session.Service),
        snapshot: yield* Effect.serviceOption(Snapshot.Service),
      }
    }).pipe(Effect.provide(SessionSummary.runnerLayer), Effect.scoped, Effect.runPromise)

    expect(resolved.summary._tag).toBe("Some")
    expect(resolved.session._tag).toBe("Some")
    expect(resolved.snapshot._tag).toBe("Some")
  })
})
