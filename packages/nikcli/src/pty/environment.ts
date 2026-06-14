import { Context, Effect, Layer } from "effect"

/**
 * Server-owned seam for the environment overlay applied when creating a PTY.
 *
 * Keeping this as a service (rather than reaching into the plugin system from
 * the PTY layer directly) decouples PTY creation from the plugin runtime: the
 * standalone server uses {@link PtyEnvironment.defaultLayer} (an empty overlay)
 * while the full app provides a plugin-backed adapter that runs the `shell.env`
 * hook. PTY creation merges caller values, then this overlay, then the
 * Core-forced terminal invariants such as `TERM` and `NIKCLI_TERMINAL`.
 */
export namespace PtyEnvironment {
  export interface Interface {
    readonly get: (input: { directory: string; cwd: string }) => Effect.Effect<Record<string, string>>
  }

  export class Service extends Context.Service<Service, Interface>()("@nikcli/PtyEnvironment") {}

  export const defaultLayer = Layer.succeed(
    Service,
    Service.of({
      get: () => Effect.succeed({}),
    }),
  )
}
