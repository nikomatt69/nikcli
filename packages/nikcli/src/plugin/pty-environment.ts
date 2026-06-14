import { Effect, Layer } from "effect"
import { Pty } from "@/pty"
import { PtyEnvironment } from "@/pty/environment"
import { Plugin } from "."

/**
 * Plugin-backed adapter for {@link PtyEnvironment}. Resolves the PTY environment
 * overlay by running the `shell.env` plugin hook in the current instance,
 * passing the resolved PTY working directory to the hook.
 */
export namespace PluginPtyEnvironment {
  export const layer = Layer.effect(
    PtyEnvironment.Service,
    Effect.gen(function* () {
      const plugin = yield* Plugin.Service
      return PtyEnvironment.Service.of({
        get: Effect.fn("PtyEnvironment.get")(function* (input) {
          const result = yield* plugin
            .trigger("shell.env", { cwd: input.cwd }, { env: {} as Record<string, string> })
            .pipe(Effect.orDie)
          return result.env
        }),
      })
    }),
  )

  /**
   * Single composed PTY layer used by every PTY route so that the in-memory
   * session store (an InstanceState-backed cache keyed by directory) stays
   * shared. Wires the plugin-backed environment overlay into PTY creation.
   */
  export const ptyLayer = Pty.layer.pipe(Layer.provide(layer), Layer.provide(Plugin.defaultLayer))
}
