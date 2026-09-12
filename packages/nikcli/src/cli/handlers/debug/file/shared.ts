import { File } from "@/file"
import { runPromiseWithLayer, withCurrentInstance } from "@/effect"
import { Effect } from "effect"

/** Helpers shared by the `file` commands. */

export function runFile<A, E>(effect: Effect.Effect<A, E, File.Service>) {
  return runPromiseWithLayer(File.defaultLayer, withCurrentInstance(effect))
}
