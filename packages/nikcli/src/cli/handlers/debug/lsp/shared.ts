import { LSP } from "@/lsp"
import { runPromiseWithLayer, withCurrentInstance } from "@/effect"
import { Effect } from "effect"

/** Helpers shared by the `lsp` commands. */

export function runLSP<A, E>(effect: Effect.Effect<A, E, LSP.Service>) {
  return runPromiseWithLayer(LSP.defaultLayer, withCurrentInstance(effect))
}
