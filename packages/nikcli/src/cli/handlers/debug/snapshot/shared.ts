import { Snapshot } from "@/snapshot"
import { Effect } from "effect"
import { runPromiseWithLayer, withCurrentInstance } from "@/effect"

/** Helpers shared by the `snapshot` commands. */

export function runSnapshot<A, E>(effect: Effect.Effect<A, E, Snapshot.Service>) {
  return runPromiseWithLayer(Snapshot.defaultLayer, withCurrentInstance(effect))
}
