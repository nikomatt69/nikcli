import type { Manifest } from "../manifest.js"
import type { Context } from "./context.js"

export type { Context, Manifest }

export type Cleanup = () => Promise<void> | void

export interface Definition {
  /**
   * Present on a v2 plugin, absent on everything else — the runtime uses it to
   * tell the two apart (`specs/effect-tui/14-plugin-v2-architecture.md`
   * requirement 11).
   *
   * Optional in the type, not in intent: the v2 shape shipped before the
   * manifest did, so a definition without one still loads, with capabilities
   * inferred and a diagnostic id of `legacy:<id>`. That migration window closes
   * once the internal plugins carry manifests.
   */
  readonly manifest?: Manifest
  readonly id: string
  readonly setup: (context: Context) => Promise<Cleanup | void> | Cleanup | void
}

export function define(plugin: Definition) {
  return plugin
}
