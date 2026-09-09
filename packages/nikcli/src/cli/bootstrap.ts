import { Log } from "@nikcli-ai/util/log"
import { InstanceBootstrap } from "../project/bootstrap"
import { Instance } from "../project/instance"
import { withInstanceAsync, type InstanceContext } from "@/effect"

const log = Log.create({ service: "bootstrap" })

/**
 * Run a CLI command body inside a bootstrapped instance.
 *
 * The body receives the instance. Every command used to reach back into the
 * ambient scope for the directory, worktree or project it was already standing
 * in — which is the same value, arrived at without saying so.
 */
export async function bootstrap<T>(directory: string, cb: (instance: InstanceContext) => Promise<T>): Promise<T> {
  log.debug("Initializing bootstrap", { directory })

  try {
    return await withInstanceAsync({ directory, init: InstanceBootstrap }, async (instance) => {
      log.debug("Executing bootstrap callback")
      const result = await cb(instance)
      log.debug("Bootstrap callback completed successfully")
      return result
    })
  } catch (error) {
    log.error("Bootstrap callback failed", { error })
    throw error
  } finally {
    log.debug("Disposing instance")
    // Outside the scope, on purpose, and this is the whole of R3.
    //
    // `withInstanceAsync` runs the body as a fiber on the instance's own `ManagedRuntime`, and
    // `Instance.dispose` tears that runtime down. Disposing from inside the body therefore made the
    // body interrupt itself at the last moment: the fiber's Exit became an interruption, the bridge
    // faithfully replayed it in the caller, and `runPromise` squashed an interrupt-only `Cause` into
    // `Error("All fibers interrupted without error")`. Every bootstrap-based command printed its
    // answer and then exited 1 — `stats` and `api` alike.
    //
    // `Instance.provide` re-enters the ALS scope `dispose` needs to resolve its context, without
    // forking onto the runtime being disposed, so nothing is running on it when it goes away.
    await Instance.provide({ directory, fn: () => Instance.dispose() }).catch((error) => {
      log.warn("instance dispose failed", { directory, error })
    })
  }
}
