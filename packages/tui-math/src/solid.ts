/**
 * `<nikcli_latex>` — the Solid intrinsic wrapping {@link LatexRenderable}.
 *
 * The element name is prefixed for the same reason `<nikcli_background>` is:
 * `extend()` writes into one process-wide catalogue shared with plugins, and
 * a bare `latex` would be the kind of name a plugin might reasonably claim.
 *
 * Registration runs on import rather than behind a call, so a component only
 * has to import the module it already needs. Re-registering is harmless.
 */
import { extend } from "@opentui/solid"
import { LatexRenderable } from "./renderable"

declare module "@opentui/solid" {
  interface OpenTUIComponents {
    nikcli_latex: typeof LatexRenderable
  }
}

extend({ nikcli_latex: LatexRenderable })

export * from "./index"
