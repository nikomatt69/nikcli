import type { Capability, Kind, Manifest, Permissions } from "../manifest.js"
import type { Context } from "./context.js"

export type { Capability, Context, Kind, Manifest, Permissions }

export type Cleanup = () => Promise<void> | void

export interface Definition {
  /**
   * Present on a v2 plugin that declares itself
   * (`specs/effect-tui/14-plugin-v2-architecture.md` requirement 2).
   *
   * Optional in the type, not in intent: the v2 shape shipped before the
   * manifest did and every internal plugin is still written that way. A
   * definition without one keeps the whole context surface and its own id —
   * gating it by default, or renaming it for diagnostics, would change the
   * identity the runtime keys slots, routes and enable state on.
   */
  readonly manifest?: Manifest
  readonly id: string
  readonly setup: (context: Context) => Promise<Cleanup | void> | Cleanup | void
}

export function define(plugin: Definition) {
  return plugin
}
